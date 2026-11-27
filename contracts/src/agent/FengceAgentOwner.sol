// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {IFengcePolicy} from "../core/interfaces/IFengcePolicy.sol";

/// Owner-gated wallets with `execute(address,uint256,bytes)`: Coinbase Smart Wallet (any owner), Light Account
/// and MultiOwnerLightAccount (owner), and others with the same entry point.
interface IOwnerExecute {
    function execute(address target, uint256 value, bytes calldata data) external payable;
}

/// FengceInspector surface (same as FengceHook's).
interface IOutcomeInspectorAO {
    function configureFor(address account, bytes calldata data) external;
    function snapshot(address account) external;
    function verify(address account, bool success, address policy) external;
}

/// @title FengceAgentOwner
/// @notice Agent path for smart wallets that have no hook or module system but accept extra owners
/// (Coinbase Smart Wallet, MultiOwnerLightAccount). The wallet adds this contract as one of its owners; agent
/// keys registered here can then act for the wallet only through this contract, and every agent call is
/// checked by the wallet's pinned TapeOut circuit (same PolicyEngine, Schema and TxFacts as FengceGuard) before
/// this contract calls the wallet's `execute`.
///
/// What it does not do: the wallet's other owners keep full control and are not checked (there is no hook to
/// check them with). They can also remove this contract as an owner at any time. It restricts agents, not owners.
///
/// A refused agent call does not revert: it emits `Denied` and executes nothing, like AgentExecutor. Agents can
/// make plain calls only; calls to the wallet itself and to this contract are refused.
contract FengceAgentOwner is PolicyEngine, IFengcePolicy {
    struct Config {
        bool set;
        bytes32 pinId;
        bytes32 netlistHash;
        uint32 nIn;
        Schema.Field[] fields;
        TxFacts.Binding[] bindings;
    }

    struct Agent {
        bool active;
        uint64 expiresAt; // 0 = no expiry
    }

    mapping(address account => Config) internal _configs;
    mapping(address account => mapping(address agent => Agent)) public agents;
    /// @notice Optional outcome-check contract per account (a FengceInspector that lists this contract as an adapter).
    mapping(address account => address) public inspectorOf;

    /// @notice A wallet set its policy.
    /// @param account The wallet
    /// @param pinId Pinned circuit
    event Configured(address indexed account, bytes32 indexed pinId);
    /// @notice A wallet authorised an agent.
    /// @param account The wallet
    /// @param agent Agent key
    /// @param expiresAt Expiry timestamp (0 = none)
    event AgentAdded(address indexed account, address indexed agent, uint64 expiresAt);
    /// @notice A wallet revoked an agent.
    /// @param account The wallet
    /// @param agent Agent key
    event AgentRevoked(address indexed account, address indexed agent);
    /// @notice An agent call passed the policy and was executed by the wallet.
    /// @param account The wallet
    /// @param agent Agent key
    /// @param to Call target
    /// @param value Native value
    /// @param dataHash keccak256 of the calldata
    event AgentExecuted(address indexed account, address indexed agent, address to, uint256 value, bytes32 dataHash);
    /// @notice An agent call was refused by the policy. Nothing was executed.
    /// @param account The wallet
    /// @param agent Agent key
    /// @param target Call target
    /// @param factsHash keccak256(abi.encode(target, value, keccak256(data)))
    /// @param reason The revert data of the check (for example HookDenied)
    event Denied(address indexed account, address indexed agent, address target, bytes32 factsHash, bytes reason);

    error HookDenied(address account, address target);
    error HookNotConfigured(address account);
    error HookBadConfig();
    error HookSelfCall(address target);
    error AgentNotAuthorised(address account, address agent);
    error AgentExpired(address account, address agent);

    constructor(PinRegistry registry_, uint256 evalGasCap_) PolicyEngine(registry_, evalGasCap_) {}

    // ------------------------------------------------------------------ wallet setup (called by the wallet)

    /// @notice Called by the wallet: set or replace its policy.
    function configure(bytes32 pinId, Schema.Layout calldata layout, TxFacts.Binding[] calldata bindings) external {
        Schema.Layout memory l = layout;
        if (!registry.isPinned(pinId)) revert EngineNotPinned(pinId);
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(pinId);
        if (Schema.hash(l) != schemaHash || l.nIn != nIn || l.netlistHash != netlistHash) revert HookBadConfig();
        Schema.validate(l);
        uint256 needed;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (bindings.length != needed) revert HookBadConfig();
        Config storage c = _configs[msg.sender];
        c.set = true;
        c.pinId = pinId;
        c.netlistHash = netlistHash;
        c.nIn = nIn;
        delete c.fields;
        delete c.bindings;
        for (uint256 i; i < l.fields.length; i++) {
            c.fields.push(l.fields[i]);
        }
        for (uint256 i; i < bindings.length; i++) {
            c.bindings.push(bindings[i]);
        }
        emit Configured(msg.sender, pinId);
    }

    /// @notice Called by the wallet: authorise an agent key. Requires a policy.
    function addAgent(address agent, uint64 expiresAt) external {
        if (!_configs[msg.sender].set) revert HookNotConfigured(msg.sender);
        agents[msg.sender][agent] = Agent(true, expiresAt);
        emit AgentAdded(msg.sender, agent, expiresAt);
    }

    /// @notice Called by the wallet: revoke an agent key.
    function revokeAgent(address agent) external {
        delete agents[msg.sender][agent];
        emit AgentRevoked(msg.sender, agent);
    }

    /// @notice Called by the wallet: connect a FengceInspector (`data` = abi.encode(address[] assets, address[] spenders)).
    function setInspector(address inspector, bytes calldata data) external {
        inspectorOf[msg.sender] = inspector;
        if (inspector != address(0)) IOutcomeInspectorAO(inspector).configureFor(msg.sender, data);
    }

    function isConfigured(address account) external view returns (bool) {
        return _configs[account].set;
    }

    // ------------------------------------------------------------------ agent path

    /// @notice The agent's only path: checked by the wallet's policy, then executed by the wallet.
    function execute(address account, address to, uint256 value, bytes calldata data) external {
        Agent memory a = agents[account][msg.sender];
        if (!a.active) revert AgentNotAuthorised(account, msg.sender);
        if (a.expiresAt != 0 && block.timestamp >= a.expiresAt) revert AgentExpired(account, msg.sender);
        try this.checkCall(account, to, value, data) {}
        catch (bytes memory reason) {
            emit Denied(account, msg.sender, to, keccak256(abi.encode(to, value, keccak256(data))), reason);
            return;
        }
        address i = inspectorOf[account];
        if (i != address(0)) IOutcomeInspectorAO(i).snapshot(account);
        IOwnerExecute(account).execute(to, value, data);
        if (i != address(0)) IOutcomeInspectorAO(i).verify(account, true, address(this));
        emit AgentExecuted(account, msg.sender, to, value, keccak256(data));
    }

    /// @notice Reverts unless `account`'s policy allows the call (no self calls, no calls to this contract).
    function checkCall(address account, address to, uint256 value, bytes calldata data) external view {
        if (to == account || to == address(this)) revert HookSelfCall(to);
        _policy(account, TxFacts.decode(account, to, value, data, false), to);
    }

    function _policy(address account, TxFacts.Facts memory f, address target)
        private
        view
        returns (bytes memory input, bytes memory out)
    {
        Config storage c = _configs[account];
        if (!c.set) revert HookNotConfigured(account);
        Schema.Layout memory l = Schema.Layout(c.netlistHash, c.nIn, c.fields);
        input = Schema.encode(l, TxFacts.values(f, c.bindings));
        out = _evaluate(c.pinId, input);
        if (uint8(out[0]) & 1 != 1) revert HookDenied(account, target);
    }

    function policyContextVersion() external pure override returns (uint16) {
        return TxFacts.CONTEXT_VERSION;
    }

    /// @notice IFengcePolicy: `account`'s policy on a canonical context; reverts unless allowed.
    function checkContext(address account, TxFacts.Facts calldata ctx)
        external
        view
        override
        returns (bytes memory input, bytes memory output)
    {
        TxFacts.Facts memory f = ctx;
        f.account = account;
        return _policy(account, f, f.to);
    }
}
