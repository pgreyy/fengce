// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITransactionGuard} from "@safe/base/GuardManager.sol";
import {IModuleGuard} from "@safe/base/ModuleManager.sol";
import {IGuardManager} from "@safe/interfaces/IGuardManager.sol";
import {IModuleManager} from "@safe/interfaces/IModuleManager.sol";
import {IERC165} from "@safe/interfaces/IERC165.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {ApprovalScan} from "../core/ApprovalScan.sol";
import {SafeAdmin} from "./SafeAdmin.sol";
import {MultiSendDecoder} from "./MultiSendDecoder.sol";
import {FengceLimits} from "./FengceLimits.sol";
import {Tick} from "../core/Tick.sol";
import {IFengceDecoder} from "../core/interfaces/IFengceDecoder.sol";
import {FengceRulesV3} from "./FengceRulesV3.sol";

/// @title FengceGuardV3
/// @notice Safe v1.5.0 transaction guard and module guard that run every outgoing call through a
/// pinned TapeOut circuit, plus the v3 rules, which also decide on TapeOut circuits: quiet hours,
/// hold lock and agent caps on NAND circuit #2; Tilt-shield on counter circuit #7 (buys in the window)
/// and the Tilt-shield latch circuit (the pause), both run by Tick. FengceRulesV3 computes the one-bit
/// facts those circuits read. One policy path serves both guards; every error denies. A refusal
/// reverts with FengceRefused(reason, ...).
///
/// Changes from v2 (FengceGuard): tightening a limit applies at once, loosening goes through the admin
/// timelock (1 day, or 7 days when the Safe names a partner, who can approve it early); refusals carry
/// a reason code; owners can record a refusal on chain without a reverted transaction (recordRefusal);
/// agent calls are keyed by (module, agent) for per-agent caps.
///
/// Order of checks for a Safe transaction:
/// 1. Delegatecall: only to MultiSendCallOnly 1.5.0; every inner call is checked as in step 4.
/// 2. Call to this guard: recovery (all owners), timelock scheduling, configuration and allowlist
///    (free until the Safe is first configured, then timelocked).
/// 3. Call to the Safe itself: installing this guard passes; any other guard or module guard needs
///    recovery; the other admin calls need the timelock; anything else is denied.
/// 4. Anything else: decode facts (TxFacts), encode them with the Safe's schema, evaluate.
/// Steps 2 and 3 make no call to the circuit, its processors or the pin registry.
contract FengceGuardV3 is PolicyEngine, SafeAdmin, ITransactionGuard, IModuleGuard {
    address public constant MULTI_SEND_CALL_ONLY = 0xA83c336B20401Af773B6219BA5027174338D1836;
    /// @notice Runtime code hash of MultiSendCallOnly v1.5.0 (same on every chain); checked, not just the address.
    bytes32 public constant MULTI_SEND_CALL_ONLY_CODEHASH = 0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663;
    /// @notice Recovery window used while a Safe has no configuration.
    uint256 public constant DEFAULT_RECOVERY_WINDOW = FengceLimits.DEFAULT_RECOVERY_WINDOW;
    /// @notice Minimum delays every configuration must meet (see FengceLimits).
    uint256 public constant MIN_ADMIN_DELAY = FengceLimits.MIN_ADMIN_DELAY;
    uint256 public constant MIN_RECOVERY_DELAY = FengceLimits.MIN_RECOVERY_DELAY;
    uint256 public constant MIN_RECOVERY_WINDOW = FengceLimits.MIN_RECOVERY_WINDOW;
    address internal constant SENTINEL_MODULES = address(0x1);

    struct Config {
        bool set;
        bytes32 pinId;
        bytes32 netlistHash;
        uint32 nIn;
        uint64 recoveryDelay;
        uint64 recoveryWindow;
        uint64 adminDelay;
        Schema.Field[] fields;
        TxFacts.Binding[] bindings;
        address tick; // optional Tick state host (stateful policy)
        bytes32 tickGroup; // Tick policy group shared by this Safe
    }

    mapping(address safe => Config) internal _configs;
    mapping(address safe => mapping(address target => mapping(bytes4 selector => bool))) public allowlisted;
    /// @notice Per-Safe decoder registry: calls to (target, selector) are decoded by this decoder into
    /// typed facts (swap, lending) instead of the generic ones.
    mapping(address safe => mapping(address target => mapping(bytes4 selector => address))) public decoders;

    /// @notice A Safe set or changed its policy configuration.
    /// @param safe The Safe
    /// @param pinId Pinned circuit the policy evaluates
    event Configured(address indexed safe, bytes32 indexed pinId);
    /// @notice A Safe changed an allowlist entry.
    /// @param safe The Safe
    /// @param target Contract called
    /// @param selector Function selector
    /// @param allowed New value
    event AllowlistSet(address indexed safe, address indexed target, bytes4 indexed selector, bool allowed);
    /// @notice First configuration went ahead despite an existing approval (override flag set).
    /// @param safe The Safe
    /// @param kind ERC-20 allowance, Permit2 allowance or approval-for-all
    /// @param token Token contract
    /// @param spender Approved spender or operator
    /// @param amount Approved amount (max for approval-for-all)
    event ExistingApprovalAccepted(
        address indexed safe, ApprovalScan.FindingKind kind, address token, address spender, uint256 amount
    );

    error FengceRefused(uint8 reason, address safe, address to);
    error FengceNotPartner(address caller);
    error FengceNotOwner(address caller);
    error FengceDryRunAllowed();
    error FengceNotRefused();
    error FengceNotConfigured(address safe);
    error FengceBadConfig();
    error FengceDelegateCallDenied(address to);
    error FengceSafeCallDenied(bytes4 selector);
    error FengceGuardCallDenied(bytes4 selector);
    error FengceInnerAdminDenied(address to);
    error FengceModuleAdminDenied(address to);
    error FengceNotAllOwners();
    error FengceExistingApprovals(uint256 count);
    error FengceDelayTooShort(uint256 given, uint256 minimum);
    error FengceModulesEnabled(uint256 count);
    error FengceModulesUnreadable(address safe);
    error FengceBadTick();

    /// @notice A Safe connected (or disconnected, tick = 0) a Tick policy group.
    /// @param safe The Safe
    /// @param tick Tick contract
    /// @param groupId Policy group
    event TickConfigured(address indexed safe, address tick, bytes32 groupId);
    /// @notice A Safe registered (or removed, decoder = 0) a decoder for (target, selector).
    /// @param safe The Safe
    /// @param target Protocol contract
    /// @param selector Function selector
    /// @param decoder IFengceDecoder
    event DecoderSet(address indexed safe, address indexed target, bytes4 indexed selector, address decoder);

    /// @notice Configuration went ahead although `module` is enabled on the Safe (override flag set).
    /// @param safe The Safe
    /// @param module An enabled module, which can act through the module guard path
    event ExistingModuleAccepted(address indexed safe, address module);

    /// @notice A refusal recorded on chain by an owner (recordRefusal), with its reason code (FengceRulesV3).
    event Refused(address indexed safe, address indexed by, uint8 indexed reason, address to, bytes32 dataHash);
    /// @notice Same signature as FengceRulesV3.Alarm: Tilt-shield tripped, loosening scheduled, partner approved,
    /// limits tightened.
    event Alarm(address indexed safe, uint8 indexed code, bytes32 ref);
    event RulesSet(address indexed safe);
    event AgentCapSet(address indexed safe, address indexed module, address indexed agent, bool on, uint256 perDay);

    /// @notice Loosening waits this long when the Safe names a partner (unless the partner approves it earlier).
    uint256 public constant PARTNER_FALLBACK = 7 days;

    /// @notice Pin of NAND circuit #2 (2 inputs), the decision circuit of quiet hours, hold lock and agent caps.
    bytes32 public immutable nandPin;
    /// @notice Tick that runs the Tilt-shield counter and latch groups.
    Tick public immutable tiltTick;

    constructor(PinRegistry registry_, uint256 evalGasCap_, bytes32[] memory counterPins, bytes32 nandPin_, Tick tiltTick_)
        PolicyEngine(registry_, evalGasCap_)
    {
        for (uint256 i; i < counterPins.length; i++) {
            FengceRulesV3.setCounterN(counterPins[i], i + 1);
        }
        nandPin = nandPin_;
        tiltTick = tiltTick_;
    }

    // ------------------------------------------------------------------ v3 rules

    /// @notice Called by the Safe. Tightening applies at once; loosening must be scheduled (scheduleAdmin).
    function setRules(FengceRulesV3.Rules calldata r) external {
        FengceRulesV3.validateRules(tiltTick, registry, r, address(this));
        FengceRulesV3.setRules(msg.sender, r);
        emit RulesSet(msg.sender);
    }

    /// @notice Called by the Safe: a daily budget in the quote token for `agent` acting through `module`.
    function setAgentCap(address module, address agent, bool on, uint256 perDay) external {
        FengceRulesV3.setCap(FengceRulesV3.capKey(msg.sender, module, agent), on, perDay);
        emit AgentCapSet(msg.sender, module, agent, on, perDay);
    }

    /// @notice The Safe's partner approves a scheduled change early: it becomes ready now.
    function partnerApprove(address safe, bytes32 id) external {
        address p = FengceRulesV3.rulesOf(safe).partner;
        if (p == address(0) || msg.sender != p) revert FengceNotPartner(msg.sender);
        if (adminReadyAt[id] <= block.timestamp) revert AdminNotReady(id);
        adminReadyAt[id] = block.timestamp;
        earliestPendingAdmin[safe] = block.timestamp;
        emit Alarm(safe, FengceRulesV3.ALARM_PARTNER_APPROVED, id);
    }

    /// @notice An owner records on chain that the guard refuses a transaction, without sending it (no reverted
    /// transaction needed). Reverts if the transaction would be allowed.
    function recordRefusal(address safe, address to, uint256 value, bytes calldata data, Enum.Operation operation) external {
        if (!ISafe(payable(safe)).isOwner(msg.sender)) revert FengceNotOwner(msg.sender);
        try this.dryRun(safe, to, value, data, operation, msg.sender) {} catch (bytes memory err) {
            uint8 code = FengceRulesV3.refusalCode(err, FengceDryRunAllowed.selector, FengceRefused.selector);
            if (code == 0) revert FengceNotRefused();
            emit Refused(safe, msg.sender, code, to, keccak256(data));
        }
    }

    /// @notice Only callable by this guard: runs the checks and always reverts (state is never kept).
    function dryRun(address safe, address to, uint256 value, bytes calldata data, Enum.Operation operation, address actor)
        external
    {
        if (msg.sender != address(this)) revert FengceNotOwner(msg.sender);
        if (operation == Enum.Operation.DelegateCall) _checkBatch(safe, to, value, data, actor, false);
        else if (to == safe || to == address(this)) revert FengceRefused(FengceRulesV3.OTHER, safe, to);
        else _checkCall(safe, to, value, data, actor, false);
        revert FengceDryRunAllowed();
    }

    /// @notice The Safe's partner clears a tripped Tilt-shield early (the latch circuit is reset).
    function partnerClearTilt(address safe) external {
        FengceRulesV3.Rules storage r = FengceRulesV3.rulesOf(safe);
        if (r.partner == address(0) || msg.sender != r.partner) revert FengceNotPartner(msg.sender);
        if (!FengceRulesV3.clearTilt(tiltTick, safe)) revert FengceRefused(FengceRulesV3.OTHER, safe, safe);
        FengceRulesV3.finish(tiltTick, true);
        emit Alarm(safe, FengceRulesV3.ALARM_PARTNER_APPROVED, r.tiltLatchGroup);
    }

    function rulesOf(address safe) external view returns (FengceRulesV3.Rules memory) {
        return FengceRulesV3.rulesOf(safe);
    }

    /// @notice Reads raw storage words (v3 rule state lives at FengceRulesV3.LOCATION; see that library for the layout).
    function extsload(bytes32 slot) external view returns (bytes32 v) {
        assembly {
            v := sload(slot)
        }
    }

    // ------------------------------------------------------------------ configuration

    /// @notice Called by the Safe. Free while the Safe has no configuration (before or right after
    /// install); afterwards only through the admin timelock. The first configuration reverts if the
    /// Safe already granted approvals (see `preflight`), unless `acceptExistingApprovals` is set.
    function configure(FengceRulesV3.ConfigInput calldata input) external {
        Schema.Layout memory l = input.layout;
        _checkDelay(input.recoveryDelay, FengceLimits.MIN_RECOVERY_DELAY);
        _checkDelay(input.recoveryWindow, FengceLimits.MIN_RECOVERY_WINDOW);
        _checkDelay(input.adminDelay, FengceLimits.MIN_ADMIN_DELAY);
        FengceRulesV3.checkModules(input.acceptExistingModules);
        if (!registry.isPinned(input.pinId)) revert EngineNotPinned(input.pinId);
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(input.pinId);
        if (FengceRulesV3.checkLayout(l) != schemaHash || l.nIn != nIn || l.netlistHash != netlistHash) revert FengceBadConfig();
        uint256 needed;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (input.bindings.length != needed) revert FengceBadConfig();

        Config storage c = _configs[msg.sender];
        if (!c.set) _firstConfigPreflight(input);
        c.set = true;
        c.pinId = input.pinId;
        c.netlistHash = netlistHash;
        c.nIn = nIn;
        c.recoveryDelay = input.recoveryDelay;
        c.recoveryWindow = input.recoveryWindow;
        c.adminDelay = input.adminDelay;
        delete c.fields;
        delete c.bindings;
        for (uint256 i; i < l.fields.length; i++) {
            c.fields.push(l.fields[i]);
        }
        for (uint256 i; i < input.bindings.length; i++) {
            c.bindings.push(input.bindings[i]);
        }
        emit Configured(msg.sender, input.pinId);
    }

    function _checkDelay(uint64 given, uint64 minimum) private pure {
        if (given < minimum) revert FengceDelayTooShort(given, minimum);
    }

    /// @notice Called by the Safe. Every allowed call then also advances `groupId` on `tick`, and is denied
    /// if the stateful circuit denies. The Safe must be a member of the group and must have set this
    /// guard as its relayer on Tick. Same rule as configure: free until first configured, then timelocked.
    function configureTick(address tick, bytes32 groupId) external {
        if (tick != address(0)) {
            if (!Tick(tick).isMember(groupId, msg.sender) || !Tick(tick).relayers(msg.sender, address(this))) {
                revert FengceBadTick();
            }
        }
        _configs[msg.sender].tick = tick;
        _configs[msg.sender].tickGroup = groupId;
        emit TickConfigured(msg.sender, tick, groupId);
    }

    /// @notice Called by the Safe. Same rule as configure: free until first configured, then timelocked.
    function setDecoder(address target, bytes4 selector, address decoder) external {
        if (target == msg.sender || target == address(this)) revert FengceBadConfig();
        decoders[msg.sender][target][selector] = decoder;
        emit DecoderSet(msg.sender, target, selector, decoder);
    }

    function _firstConfigPreflight(FengceRulesV3.ConfigInput calldata input) private {
        ApprovalScan.Finding[] memory f = FengceRulesV3.scan(msg.sender, input.preflightTokens, input.preflightSpenders);
        if (f.length == 0) return;
        if (!input.acceptExistingApprovals) revert FengceExistingApprovals(f.length);
        for (uint256 i; i < f.length; i++) {
            emit ExistingApprovalAccepted(msg.sender, f[i].kind, f[i].token, f[i].spender, f[i].amount);
        }
    }

    /// @notice Called by the Safe. Lets calls to (target, selector) reach the circuit as Call facts,
    /// and lets setApprovalForAll(true) on `target` reach it as an approval. Same rule as configure:
    /// free until first configured, then timelocked.
    function setAllowlisted(address target, bytes4 selector, bool allowed) external {
        if (target == msg.sender || target == address(this)) revert FengceBadConfig();
        allowlisted[msg.sender][target][selector] = allowed;
        emit AllowlistSet(msg.sender, target, selector, allowed);
    }

    /// @notice A Safe's configuration without the schema arrays (see `schemaOf`).
    function configOf(address safe)
        external
        view
        returns (
            bool set,
            bytes32 pinId,
            uint64 recoveryDelay,
            uint64 recoveryWindow,
            uint64 adminDelay,
            address tick,
            bytes32 tickGroup
        )
    {
        Config storage c = _configs[safe];
        return (c.set, c.pinId, c.recoveryDelay, c.recoveryWindow, c.adminDelay, c.tick, c.tickGroup);
    }

    // ------------------------------------------------------------------ transaction guard

    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory signatures,
        address msgSender
    ) external override {
        address safe = msg.sender;
        if (operation == Enum.Operation.DelegateCall) {
            _checkBatch(safe, to, value, data, msgSender, false);
        } else if (to == address(this)) {
            _checkGuardCall(safe, value, data, signatures, msgSender);
        } else if (to == safe) {
            _checkSafeCall(safe, value, data);
        } else {
            _checkCall(safe, to, value, data, msgSender, false);
        }
    }

    function checkAfterExecution(bytes32, bool success) external override {
        _after(msg.sender, success);
    }

    function _after(address safe, bool success) private {
        if (!success) _rollbackTick(safe);
        FengceRulesV3.finish(tiltTick, success);
    }

    // ------------------------------------------------------------------ module guard

    function checkModuleTransaction(address to, uint256 value, bytes memory data, Enum.Operation operation, address module)
        external
        override
        returns (bytes32)
    {
        address safe = msg.sender;
        if (operation == Enum.Operation.DelegateCall) {
            _checkBatch(safe, to, value, data, module, true);
        } else {
            // Modules never reach recovery, the timelock or Safe admin functions.
            if (to == safe || to == address(this)) revert FengceModuleAdminDenied(to);
            _checkCall(safe, to, value, data, module, true);
        }
        return keccak256(abi.encode(safe, to, value, keccak256(data), operation, module));
    }

    function checkAfterModuleExecution(bytes32, bool success) external override {
        _after(msg.sender, success);
    }

    function supportsInterface(bytes4 id) external pure override returns (bool) {
        return id == type(ITransactionGuard).interfaceId || id == type(IModuleGuard).interfaceId
            || id == type(IERC165).interfaceId;
    }

    // ------------------------------------------------------------------ branches

    function _checkGuardCall(address safe, uint256 value, bytes memory data, bytes memory signatures, address msgSender)
        private
    {
        bytes4 sel = TxFacts.selectorOf(data);
        if (value != 0) revert FengceGuardCallDenied(sel);
        if (sel == this.scheduleRecovery.selector && data.length == 4) {
            _requireAllOwners(safe, signatures, msgSender);
            return;
        }
        if (sel == this.scheduleAdmin.selector) {
            emit Alarm(safe, FengceRulesV3.ALARM_LOOSEN_SCHEDULED, keccak256(data));
            return;
        }
        if (sel == this.cancelRecovery.selector || sel == this.cancelAdmin.selector) return;
        if (_isGuardConfigCall(data)) {
            if (_configs[safe].set) {
                if (_tightens(safe, data)) emit Alarm(safe, FengceRulesV3.ALARM_TIGHTENED, keccak256(data));
                else _consumeAdmin(safe, address(this), data);
            }
            return;
        }
        revert FengceGuardCallDenied(sel);
    }

    function _checkSafeCall(address safe, uint256 value, bytes memory data) private {
        bytes4 sel = TxFacts.selectorOf(data);
        if (value != 0) revert FengceSafeCallDenied(sel);
        if (sel == IGuardManager.setGuard.selector || sel == IModuleManager.setModuleGuard.selector) {
            if (data.length != 36) revert FengceSafeCallDenied(sel);
            uint256 target;
            assembly {
                target := mload(add(data, 36))
            }
            if (target >> 160 != 0) revert FengceSafeCallDenied(sel);
            if (target == uint160(address(this))) return; // installing Fengce itself always passes
            _requireRecovery(safe, sel, address(uint160(target)));
            return;
        }
        if (!_isAdminSelector(sel)) revert FengceSafeCallDenied(sel);
        _consumeAdmin(safe, safe, data);
    }

    function _checkBatch(address safe, address to, uint256 value, bytes memory data, address actor, bool viaModule)
        private
    {
        if (to != MULTI_SEND_CALL_ONLY || value != 0 || to.codehash != MULTI_SEND_CALL_ONLY_CODEHASH) {
            revert FengceDelegateCallDenied(to);
        }
        MultiSendDecoder.Call[] memory calls = FengceRulesV3.decodeBatch(data, safe);
        for (uint256 i; i < calls.length; i++) {
            address t = calls[i].to;
            if (t == safe || t == address(this)) revert FengceInnerAdminDenied(t);
            _checkCall(safe, t, calls[i].value, calls[i].data, actor, viaModule);
        }
    }

    /// @dev The single policy path shared by both guards.
    function _checkCall(address safe, address to, uint256 value, bytes memory data, address actor, bool viaModule)
        private
    {
        Config storage c = _configs[safe];
        if (!c.set) revert FengceNotConfigured(safe);
        bytes4 sel = TxFacts.selectorOf(data);
        address decoder = decoders[safe][to][sel];
        TxFacts.Facts memory f = decoder != address(0)
            ? IFengceDecoder(decoder).decode(safe, to, value, data)
            : FengceRulesV3.decodeFacts(safe, to, value, data, allowlisted[safe][to][sel]);
        f.account = safe;
        f.actor = actor;
        bytes32 agentKey = viaModule ? _agentKey(safe, actor) : bytes32(0);
        FengceRulesV3.Bits memory b = FengceRulesV3.facts(safe, f, agentKey);
        if (b.quietA) _nand(FengceRulesV3.QUIET_HOURS, b.quietB, safe, to);
        if (b.holdA) _nand(FengceRulesV3.HOLD_LOCK, b.holdB, safe, to);
        if (b.capA) _nand(FengceRulesV3.AGENT_CAP, b.capB, safe, to);
        _policy(safe, c, f, to);
        // Tilt-shield before trades per hour: a paused buy is reported as TILT_SHIELD
        if (b.buy) {
            uint8 t = FengceRulesV3.tilt(tiltTick, safe, f, b);
            if (t != 0) revert FengceRefused(t, safe, to);
        }
        _advanceTick(safe, c, f);
        FengceRulesV3.record(safe, f, agentKey);
    }

    /// @dev A rule that applies to this call: NAND circuit #2 decides allow = NOT(1 AND condition).
    function _nand(uint8 code, bool condition, address safe, address to) private view {
        bytes memory out = _evaluate(nandPin, abi.encodePacked(uint8(condition ? 3 : 1)));
        if (uint8(out[0]) & 1 != 1) revert FengceRefused(code, safe, to);
    }


    /// @dev Per-agent key: (Safe, module, agent). A module that reports its current agent (AgentExecutorV3) gets
    /// one key per agent; any other module is one key.
    function _agentKey(address safe, address module) private view returns (bytes32) {
        address agent;
        (bool ok, bytes memory ret) = module.staticcall{gas: 30_000}(abi.encodeWithSignature("currentAgent()"));
        if (ok && ret.length == 32 && uint256(bytes32(ret)) >> 160 == 0) agent = address(uint160(uint256(bytes32(ret))));
        return FengceRulesV3.capKey(safe, module, agent);
    }

    /// @dev Stateful part of the policy: advance the Safe's Tick group (reverts if it denies) and
    /// remember it in transient storage so a failed Safe transaction can roll it back.
    function _advanceTick(address safe, Config storage c, TxFacts.Facts memory f) private {
        address tick = c.tick;
        if (tick == address(0)) return;
        bytes32 group = c.tickGroup;
        try Tick(tick).advanceFacts(safe, group, f) {}
        catch {
            revert FengceRefused(FengceRulesV3.TRADES_PER_HOUR, safe, f.to);
        }
        bytes32 k = keccak256(abi.encode("fengce.guard.tick", safe));
        assembly {
            tstore(k, tick)
            tstore(add(k, 1), group)
        }
    }

    function _rollbackTick(address safe) private {
        bytes32 k = keccak256(abi.encode("fengce.guard.tick", safe));
        address tick;
        bytes32 group;
        assembly {
            tick := tload(k)
            group := tload(add(k, 1))
        }
        if (tick == address(0)) return;
        assembly {
            tstore(k, 0)
            tstore(add(k, 1), 0)
        }
        Tick(tick).rollback(group);
    }

    function _policy(address safe, Config storage c, TxFacts.Facts memory f, address to)
        private
        view
        returns (bytes memory input, bytes memory out)
    {
        Schema.Layout memory l = Schema.Layout(c.netlistHash, c.nIn, c.fields);
        input = FengceRulesV3.encodeInput(l, f, c.bindings);
        out = _evaluate(c.pinId, input);
        if (uint8(out[0]) & 1 != 1) revert FengceRefused(FengceRulesV3.CIRCUIT, safe, to);
    }

    // ------------------------------------------------------------------ signatures

    /// @dev Requires signatures from every owner on the Safe transaction being checked. The Safe has
    /// already incremented its nonce, so the transaction used nonce - 1.
    function _requireAllOwners(address safe, bytes memory signatures, address msgSender) private view {
        uint256 owners = ISafe(payable(safe)).getOwners().length;
        bytes32 txHash = _safeTxHash(safe);
        try ISafe(payable(safe)).checkNSignatures(msgSender, txHash, signatures, owners) {}
        catch {
            revert FengceNotAllOwners();
        }
    }

    /// @dev Rebuilds the Safe transaction hash from this call's own calldata. checkTransaction and
    /// getTransactionHash share their first nine arguments; argument ten (the signatures offset
    /// here) is replaced by the nonce. The `data` offset still points at the same bytes.
    function _safeTxHash(address safe) private view returns (bytes32) {
        uint256 txNonce = ISafe(payable(safe)).nonce() - 1;
        bytes memory cd = abi.encodePacked(ISafe.getTransactionHash.selector, msg.data[4:]);
        assembly {
            mstore(add(cd, 324), txNonce) // 32 (length) + 4 (selector) + 9 * 32
        }
        (bool ok, bytes memory ret) = safe.staticcall(cd);
        if (!ok || ret.length != 32) revert FengceNotAllOwners();
        return abi.decode(ret, (bytes32));
    }

    // ------------------------------------------------------------------ SafeAdmin hooks

    function _recoveryDelay(address safe) internal view override returns (uint256) {
        return _configs[safe].recoveryDelay;
    }

    function _recoveryWindow(address safe) internal view override returns (uint256) {
        Config storage c = _configs[safe];
        return c.set ? c.recoveryWindow : DEFAULT_RECOVERY_WINDOW;
    }

    function _adminDelay(address safe) internal view override returns (uint256) {
        uint256 d = _configs[safe].adminDelay;
        if (FengceRulesV3.rulesOf(safe).partner != address(0) && d < PARTNER_FALLBACK) return PARTNER_FALLBACK;
        return d;
    }

    // ------------------------------------------------------------------ tighten or loosen

    /// @dev True if a guard configuration call only tightens, so it can apply without the timelock.
    function _tightens(address safe, bytes memory data) private view returns (bool) {
        Config storage c = _configs[safe];
        return FengceRulesV3.tightens(
            safe,
            data,
            FengceRulesV3.Current(c.pinId, [c.recoveryDelay, c.adminDelay, type(uint64).max - c.recoveryWindow], c.bindings, c.tick, c.tickGroup),
            tiltTick
        );
    }

    function _isGuardConfigCall(bytes memory data) internal pure override returns (bool) {
        bytes4 sel = TxFacts.selectorOf(data);
        return sel == FengceGuardV3.configure.selector || sel == FengceGuardV3.setAllowlisted.selector
            || sel == FengceGuardV3.configureTick.selector || sel == FengceGuardV3.setDecoder.selector
            || sel == FengceGuardV3.setRules.selector || sel == FengceGuardV3.setAgentCap.selector;
    }
}
