// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

/// @title AgentExecutor
/// @notice Safe module that lets an agent key (never an owner) act for a Safe, only through Fengce.
/// A refused call does not revert: it emits `Denied` and executes nothing, so blocked attempts are visible.
/// Every agent call goes through `execTransactionFromModule`, where the Safe's module guard (the
/// FengceGuard this executor is bound to) runs the circuit. The executor refuses to act if that guard
/// is not the Safe's module guard. Agents can only make plain calls (no delegatecall).
///
/// Adding an agent is a Safe transaction to this contract, so with FengceGuard installed it must be
/// allowlisted (and after the first configuration, allowlist changes are timelocked). Revoking is
/// immediate and can be done by the Safe or by any single owner.
contract AgentExecutor {
    /// keccak256("module_manager.module_guard.address")
    bytes32 internal constant MODULE_GUARD_SLOT = 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947;

    struct Agent {
        bool active;
        uint64 expiresAt; // 0 = no expiry
    }

    address public immutable guard;
    mapping(address safe => mapping(address agent => Agent)) public agents;

    /// @notice A Safe authorised an agent.
    /// @param safe The Safe
    /// @param agent Agent key
    /// @param expiresAt Expiry timestamp (0 = none)
    event AgentAdded(address indexed safe, address indexed agent, uint64 expiresAt);
    /// @notice An agent was revoked.
    /// @param safe The Safe
    /// @param agent Agent key
    /// @param by The Safe or the owner who revoked it
    event AgentRevoked(address indexed safe, address indexed agent, address by);
    /// @notice An agent call went through the Safe (and its module guard).
    /// @param safe The Safe
    /// @param agent Agent key
    /// @param to Call target
    /// @param value Native value
    /// @param dataHash keccak256 of the calldata
    event AgentExecuted(address indexed safe, address indexed agent, address to, uint256 value, bytes32 dataHash);
    /// @notice An agent call was refused by the Safe's guard (policy, Tick, floor or outcome check). Nothing
    /// was executed; the agent's transaction succeeds so the attempt is on record.
    /// @param safe The Safe
    /// @param agent Agent key
    /// @param target Call target
    /// @param factsHash keccak256(abi.encode(target, value, keccak256(data))): the action the agent asked for
    /// @param reason The guard's revert data (for example FengceDenied, TickDenied, FloorDenied)
    event Denied(address indexed safe, address indexed agent, address target, bytes32 factsHash, bytes reason);

    error AgentNotAuthorised(address safe, address agent);
    error AgentExpired(address safe, address agent);
    error AgentGuardMissing(address safe);
    error AgentNotOwner(address caller);

    constructor(address guard_) {
        guard = guard_;
    }

    /// @notice Called by the Safe (a Safe transaction). Requires the Fengce module guard to be installed.
    function addAgent(address agent, uint64 expiresAt) external {
        _requireGuard(msg.sender);
        agents[msg.sender][agent] = Agent(true, expiresAt);
        emit AgentAdded(msg.sender, agent, expiresAt);
    }

    /// @notice Revokes an agent. Callable by the Safe itself or by any of its owners.
    function revokeAgent(address safe, address agent) external {
        if (msg.sender != safe && !ISafe(payable(safe)).isOwner(msg.sender)) revert AgentNotOwner(msg.sender);
        delete agents[safe][agent];
        emit AgentRevoked(safe, agent, msg.sender);
    }

    /// @notice The agent's only path: a plain call executed by the Safe as a module transaction, checked
    /// by the Safe's module guard (the Fengce circuit). Reverts with the Safe's revert data on failure.
    function execute(address safe, address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        Agent memory a = agents[safe][msg.sender];
        if (!a.active) revert AgentNotAuthorised(safe, msg.sender);
        if (a.expiresAt != 0 && block.timestamp >= a.expiresAt) revert AgentExpired(safe, msg.sender);
        _requireGuard(safe);
        bool ok;
        bytes memory ret;
        try ISafe(payable(safe)).execTransactionFromModuleReturnData(to, value, data, Enum.Operation.Call) returns (
            bool success, bytes memory returnData
        ) {
            (ok, ret) = (success, returnData);
        } catch (bytes memory reason) {
            // The module guard reverted: a policy denial. Record it instead of reverting.
            emit Denied(safe, msg.sender, to, keccak256(abi.encode(to, value, keccak256(data))), reason);
            return "";
        }
        if (!ok) {
            // The call itself failed after the guard allowed it.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit AgentExecuted(safe, msg.sender, to, value, keccak256(data));
        return ret;
    }

    function _requireGuard(address safe) private view {
        bytes memory raw = ISafe(payable(safe)).getStorageAt(uint256(MODULE_GUARD_SLOT), 1);
        if (raw.length != 32 || abi.decode(raw, (address)) != guard) revert AgentGuardMissing(safe);
    }
}
