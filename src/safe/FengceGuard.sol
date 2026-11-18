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
import {FengceInspector} from "./FengceInspector.sol";
import {IFengceDecoder} from "../core/interfaces/IFengceDecoder.sol";
import {IFengcePolicy} from "../core/interfaces/IFengcePolicy.sol";

/// @title FengceGuard
/// @notice Safe v1.5.0 transaction guard and module guard that run every outgoing call through a
/// pinned TapeOut circuit. One policy path serves both guards. A call is allowed only if the
/// circuit's output bit 0 is 1; every error denies.
///
/// Order of checks for a Safe transaction:
/// 1. Delegatecall: only to MultiSendCallOnly 1.5.0; every inner call is checked as in step 4.
/// 2. Call to this guard: recovery (all owners), timelock scheduling, configuration and allowlist
///    (free until the Safe is first configured, then timelocked).
/// 3. Call to the Safe itself: installing this guard passes; any other guard or module guard needs
///    recovery; the other admin calls need the timelock; anything else is denied.
/// 4. Anything else: decode facts (TxFacts), encode them with the Safe's schema, evaluate.
/// Steps 2 and 3 make no call to the circuit, its processors or the pin registry.
contract FengceGuard is PolicyEngine, SafeAdmin, ITransactionGuard, IModuleGuard, IFengcePolicy {
    address public constant MULTI_SEND_CALL_ONLY = 0xA83c336B20401Af773B6219BA5027174338D1836;
    /// @notice Runtime code hash of MultiSendCallOnly v1.5.0 (same on every chain); checked, not just the address.
    bytes32 public constant MULTI_SEND_CALL_ONLY_CODEHASH = 0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663;
    /// @notice Rhinestone Safe7579 adapter v1.0.0 (canonical address) and the helper it delegatecalls
    /// for module installs, with the helper's runtime code hash.
    address public constant SAFE7579 = 0x7579EE8307284F293B1927136486880611F20002;
    address public constant SAFE7579_UTIL = 0x45D7deB1229E0254a0561a2769B4A28e4e67Df00;
    bytes32 public constant SAFE7579_UTIL_CODEHASH = 0x8f0d2fbb486628e5358279f76072cf0491d49b982c96d7de72f7f601e4872d6a;
    bytes4 internal constant UTIL_INSTALL = 0x9517e29f; // installModule(uint256,address,bytes)
    bytes4 internal constant UTIL_UNINSTALL = 0x78272525; // unInstallModule(uint256,address,bytes)
    /// @notice Recovery window used while a Safe has no configuration.
    uint256 public constant DEFAULT_RECOVERY_WINDOW = FengceLimits.DEFAULT_RECOVERY_WINDOW;
    /// @notice Minimum delays every configuration must meet (see FengceLimits).
    uint256 public constant MIN_ADMIN_DELAY = FengceLimits.MIN_ADMIN_DELAY;
    uint256 public constant MIN_RECOVERY_DELAY = FengceLimits.MIN_RECOVERY_DELAY;
    uint256 public constant MIN_RECOVERY_WINDOW = FengceLimits.MIN_RECOVERY_WINDOW;
    address internal constant SENTINEL_MODULES = address(0x1);

    struct ConfigInput {
        bytes32 pinId;
        Schema.Layout layout;
        TxFacts.Binding[] bindings; // one per non-Flag field, in field order
        uint64 recoveryDelay; // >= MIN_RECOVERY_DELAY
        uint64 recoveryWindow; // >= MIN_RECOVERY_WINDOW
        uint64 adminDelay; // >= MIN_ADMIN_DELAY
        address[] preflightTokens; // checked for existing approvals on first configuration
        address[] preflightSpenders; // Permit2 is always added
        bool acceptExistingApprovals; // override: configure anyway and emit warnings
        bool acceptExistingModules; // override: configure despite enabled modules and emit warnings
    }

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
        address inspector; // optional FengceInspector (outcome facts)
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

    error FengceDenied(address safe, address to);
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

    constructor(PinRegistry registry_, uint256 evalGasCap_) PolicyEngine(registry_, evalGasCap_) {}

    // ------------------------------------------------------------------ configuration

    /// @notice Called by the Safe. Free while the Safe has no configuration (before or right after
    /// install); afterwards only through the admin timelock. The first configuration reverts if the
    /// Safe already granted approvals (see `preflight`), unless `acceptExistingApprovals` is set.
    function configure(ConfigInput calldata input) external {
        Schema.Layout memory l = input.layout;
        _checkDelay(input.recoveryDelay, FengceLimits.MIN_RECOVERY_DELAY);
        _checkDelay(input.recoveryWindow, FengceLimits.MIN_RECOVERY_WINDOW);
        _checkDelay(input.adminDelay, FengceLimits.MIN_ADMIN_DELAY);
        _checkModules(input.acceptExistingModules);
        if (!registry.isPinned(input.pinId)) revert EngineNotPinned(input.pinId);
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(input.pinId);
        if (Schema.hash(l) != schemaHash || l.nIn != nIn || l.netlistHash != netlistHash) revert FengceBadConfig();
        Schema.validate(l);
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

    /// @dev Reads the calling Safe's enabled modules. Reverts if there are any, unless `accept` is
    /// set, in which case it emits one ExistingModuleAccepted per module.
    function _checkModules(bool accept) private {
        address start = SENTINEL_MODULES;
        uint256 count;
        for (uint256 page; page < 64; page++) {
            address[] memory mods;
            address next;
            try ISafe(payable(msg.sender)).getModulesPaginated(start, FengceLimits.MODULE_PAGE) returns (
                address[] memory m, address n
            ) {
                (mods, next) = (m, n);
            } catch {
                revert FengceModulesUnreadable(msg.sender);
            }
            count += mods.length;
            if (mods.length != 0 && !accept) revert FengceModulesEnabled(count);
            for (uint256 i; i < mods.length; i++) {
                emit ExistingModuleAccepted(msg.sender, mods[i]);
            }
            if (next == SENTINEL_MODULES || next == address(0) || mods.length == 0) return;
            start = next;
        }
        revert FengceModulesUnreadable(msg.sender);
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

    /// @notice Called by the Safe: connect a FengceInspector (outcome checks) and set its watched assets and
    /// spenders (`data` = abi.encode(address[] assets, address[] spenders)). Same rule as configure.
    function configureInspector(address inspector, bytes calldata data) external {
        _configs[msg.sender].inspector = inspector;
        if (inspector != address(0)) FengceInspector(inspector).configureFor(msg.sender, data);
    }

    /// @notice Called by the Safe. Same rule as configure: free until first configured, then timelocked.
    function setDecoder(address target, bytes4 selector, address decoder) external {
        if (target == msg.sender || target == address(this)) revert FengceBadConfig();
        decoders[msg.sender][target][selector] = decoder;
        emit DecoderSet(msg.sender, target, selector, decoder);
    }

    function _firstConfigPreflight(ConfigInput calldata input) private {
        ApprovalScan.Finding[] memory f = preflight(msg.sender, input.preflightTokens, input.preflightSpenders);
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

    /// @notice Install preflight: existing ERC-20 allowances, Permit2 allowances and
    /// isApprovedForAll that `safe` granted for the given tokens and spenders (Permit2 is always
    /// included as a spender). Any finding means funds can leave without a guarded transaction.
    function preflight(address safe, address[] calldata tokens, address[] calldata spenders)
        public
        view
        returns (ApprovalScan.Finding[] memory)
    {
        return ApprovalScan.scan(safe, tokens, spenders);
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
            _checkBatch(safe, to, value, data, msgSender);
            _snapshot(safe);
        } else if (to == address(this)) {
            _checkGuardCall(safe, value, data, signatures, msgSender);
        } else if (to == safe) {
            _checkSafeCall(safe, value, data);
        } else {
            _checkCall(safe, to, value, data, msgSender);
            _snapshot(safe);
        }
    }

    function checkAfterExecution(bytes32, bool success) external override {
        _after(msg.sender, success);
    }

    /// @dev Outcome checks (FengceInspector): snapshot before a policy-checked execution, verify after.
    /// Admin-path transactions take no snapshot, so their configuration changes are not flagged.
    function _snapshot(address safe) private {
        address i = _configs[safe].inspector;
        if (i != address(0)) FengceInspector(i).snapshot(safe);
    }

    function _after(address safe, bool success) private {
        if (!success) _rollbackTick(safe);
        address i = _configs[safe].inspector;
        if (i != address(0)) FengceInspector(i).verify(safe, success, address(this));
    }

    // ------------------------------------------------------------------ module guard

    function checkModuleTransaction(address to, uint256 value, bytes memory data, Enum.Operation operation, address module)
        external
        override
        returns (bytes32)
    {
        address safe = msg.sender;
        if (operation == Enum.Operation.DelegateCall) {
            if (to == SAFE7579_UTIL) {
                _check7579ModuleChange(safe, value, data, module);
            } else {
                _checkBatch(safe, to, value, data, module);
                _snapshot(safe);
            }
        } else {
            // Modules never reach recovery, the timelock or Safe admin functions.
            if (to == safe || to == address(this)) revert FengceModuleAdminDenied(to);
            _checkCall(safe, to, value, data, module);
            _snapshot(safe);
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
        if (
            sel == this.cancelRecovery.selector || sel == this.scheduleAdmin.selector
                || sel == this.cancelAdmin.selector
        ) return;
        if (_isGuardConfigCall(data)) {
            if (_configs[safe].set) _consumeAdmin(safe, address(this), data);
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
        if ((sel == ERC7579_INSTALL || sel == ERC7579_UNINSTALL) && data.length >= 68) {
            // The adapter will delegatecall its helper in this same transaction; let that one through.
            (uint256 moduleType, address module) = _moduleArgs(data);
            bytes32 key = erc7579AdminId(safe, sel == ERC7579_INSTALL, moduleType, module);
            assembly {
                tstore(key, 1)
            }
        }
    }

    /// @dev Safe7579 installs and removes ERC-7579 modules by having the Safe delegatecall its helper.
    /// Allowed only from the adapter itself, to the helper with the expected code, for a change that
    /// either an owner transaction just consumed from the timelock (same transaction) or that is
    /// scheduled and ready (a validator-approved user operation).
    function _check7579ModuleChange(address safe, uint256 value, bytes memory data, address module) private {
        bytes4 sel = _sel(data);
        if (
            module != SAFE7579 || value != 0 || SAFE7579_UTIL.codehash != SAFE7579_UTIL_CODEHASH
                || (sel != UTIL_INSTALL && sel != UTIL_UNINSTALL) || data.length < 68
        ) revert FengceDelegateCallDenied(SAFE7579_UTIL);
        (uint256 moduleType, address m) = _moduleArgs(data);
        bytes32 key = erc7579AdminId(safe, sel == UTIL_INSTALL, moduleType, m);
        uint256 approved;
        assembly {
            approved := tload(key)
        }
        if (approved == 1) {
            assembly {
                tstore(key, 0)
            }
        } else {
            _consumeAdminId(safe, key);
        }
    }

    function _checkBatch(address safe, address to, uint256 value, bytes memory data, address actor) private {
        if (to != MULTI_SEND_CALL_ONLY || value != 0 || to.codehash != MULTI_SEND_CALL_ONLY_CODEHASH) {
            revert FengceDelegateCallDenied(to);
        }
        MultiSendDecoder.Call[] memory calls = MultiSendDecoder.decode(data, safe);
        for (uint256 i; i < calls.length; i++) {
            address t = calls[i].to;
            if (t == safe || t == address(this)) revert FengceInnerAdminDenied(t);
            _checkCall(safe, t, calls[i].value, calls[i].data, actor);
        }
    }

    /// @dev The single policy path shared by both guards.
    function _checkCall(address safe, address to, uint256 value, bytes memory data, address actor) private {
        Config storage c = _configs[safe];
        if (!c.set) revert FengceNotConfigured(safe);
        bytes4 sel = TxFacts.selectorOf(data);
        address decoder = decoders[safe][to][sel];
        TxFacts.Facts memory f = decoder != address(0)
            ? IFengceDecoder(decoder).decode(safe, to, value, data)
            : TxFacts.decode(safe, to, value, data, allowlisted[safe][to][sel]);
        f.account = safe;
        f.actor = actor;
        _policy(safe, c, f, to);
        _advanceTick(safe, c, f);
    }

    /// @dev Stateful part of the policy: advance the Safe's Tick group (reverts if it denies) and
    /// remember it in transient storage so a failed Safe transaction can roll it back.
    function _advanceTick(address safe, Config storage c, TxFacts.Facts memory f) private {
        address tick = c.tick;
        if (tick == address(0)) return;
        bytes32 group = c.tickGroup;
        Tick(tick).advanceFacts(safe, group, f);
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
        input = Schema.encode(l, TxFacts.values(f, c.bindings));
        out = _evaluate(c.pinId, input);
        if (uint8(out[0]) & 1 != 1) revert FengceDenied(safe, to);
    }

    function policyContextVersion() external pure override returns (uint16) {
        return TxFacts.CONTEXT_VERSION;
    }

    /// @notice IFengcePolicy: runs `account`'s policy on a canonical context and reverts unless the
    /// circuit allows it. Used by FengceSignatureVerifier for off-chain approvals. View only: Tick is not
    /// advanced on this path.
    function checkContext(address account, TxFacts.Facts calldata ctx)
        external
        view
        override
        returns (bytes memory input, bytes memory output)
    {
        Config storage c = _configs[account];
        if (!c.set) revert FengceNotConfigured(account);
        TxFacts.Facts memory f = ctx;
        f.account = account;
        return _policy(account, c, f, f.to);
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
        return _configs[safe].adminDelay;
    }

    function _isGuardConfigCall(bytes memory data) internal pure override returns (bool) {
        bytes4 sel = TxFacts.selectorOf(data);
        return sel == FengceGuard.configure.selector || sel == FengceGuard.setAllowlisted.selector
            || sel == FengceGuard.configureTick.selector || sel == FengceGuard.setDecoder.selector
            || sel == FengceGuard.configureInspector.selector;
    }
}
