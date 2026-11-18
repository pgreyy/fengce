// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {PinRegistry} from "../core/PinRegistry.sol";
import {FengceGuard} from "../safe/FengceGuard.sol";

/// @title FengceBinding
/// @notice Lets other contracts check that an account is bound to a Fengce policy: the account is a Safe
/// whose transaction guard and module guard are the trusted FengceGuard, configured with a pinned policy
/// whose hash matches, and no policy or admin change can take effect before a given notice period.
///
/// policyHash = keccak256(abi.encode(netlistHash, refClosureHash, schemaHash)) of the pinned circuit: the
/// root circuit, every circuit it references, and the input layout.
/// earliestChange = the soonest time any guard, policy or admin change could execute:
///   min(now + adminDelay, now + recoveryDelay, earliest pending admin call, scheduled recovery ready time)
/// (a pending item that is already ready counts as "now"). The pending-admin figure is a lower bound.
contract FengceBinding {
    /// keccak256("guard_manager.guard.address")
    uint256 internal constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    /// keccak256("module_manager.module_guard.address")
    uint256 internal constant MODULE_GUARD_SLOT = 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947;

    struct Policy {
        bool configured;
        bytes32 pinId;
        bytes32 policyHash;
        bytes32 refClosureHash;
        bytes32 schemaHash;
        bool pinned; // the pin still holds
        bool guardInstalled; // transaction guard is the trusted FengceGuard
        bool moduleGuardInstalled; // module guard is the trusted FengceGuard
        uint256 earliestChange; // soonest time a guard, policy or admin change could execute
        uint256 pendingAdmins;
        uint256 recoveryReadyAt; // 0 if no recovery scheduled
        uint256 recoveryExpiresAt;
    }

    FengceGuard public immutable guard;
    PinRegistry public immutable registry;

    constructor(FengceGuard guard_) {
        guard = guard_;
        registry = guard_.registry();
    }

    function policyOf(address account) public view returns (Policy memory p) {
        if (account.code.length == 0) return p;
        p.guardInstalled = _slot(account, GUARD_SLOT) == address(guard);
        p.moduleGuardInstalled = _slot(account, MODULE_GUARD_SLOT) == address(guard);
        (bool set, bytes32 pinId, uint64 recoveryDelay,, uint64 adminDelay,,) = guard.configOf(account);
        p.configured = set;
        if (!set) return p;
        p.pinId = pinId;
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);
        p.refClosureHash = c.refClosureHash;
        p.schemaHash = c.schemaHash;
        p.policyHash = keccak256(abi.encode(c.netlistHash, c.refClosureHash, c.schemaHash));
        p.pinned = registry.isPinned(pinId);

        uint256 earliest = block.timestamp + (adminDelay < recoveryDelay ? adminDelay : recoveryDelay);
        p.pendingAdmins = guard.pendingAdmins(account);
        if (p.pendingAdmins != 0) earliest = _min(earliest, _notPast(guard.earliestPendingAdmin(account)));
        p.recoveryReadyAt = guard.recoveryReadyAt(account);
        p.recoveryExpiresAt = guard.recoveryExpiresAt(account);
        if (p.recoveryReadyAt != 0 && block.timestamp < p.recoveryExpiresAt) {
            earliest = _min(earliest, _notPast(p.recoveryReadyAt));
        }
        p.earliestChange = earliest;
    }

    /// @notice True if `account` is bound to `policyHash` and nothing can change for at least `minNotice` seconds.
    function isBound(address account, bytes32 policyHash, uint256 minNotice) public view returns (bool) {
        Policy memory p = policyOf(account);
        return p.configured && p.pinned && p.guardInstalled && p.moduleGuardInstalled && p.policyHash == policyHash
            && p.earliestChange >= block.timestamp + minNotice;
    }

    /// @notice The policyHash of a pin, for integrators choosing which policy to require.
    function policyHashOf(bytes32 pinId) external view returns (bytes32) {
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);
        return keccak256(abi.encode(c.netlistHash, c.refClosureHash, c.schemaHash));
    }

    function _slot(address safe, uint256 s) private view returns (address a) {
        try ISafe(payable(safe)).getStorageAt(s, 1) returns (bytes memory raw) {
            if (raw.length == 32) a = abi.decode(raw, (address));
        } catch {}
    }

    function _notPast(uint256 t) private view returns (uint256) {
        return t < block.timestamp ? block.timestamp : t;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
