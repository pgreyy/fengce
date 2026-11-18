// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IGuardManager} from "@safe/interfaces/IGuardManager.sol";
import {IModuleManager} from "@safe/interfaces/IModuleManager.sol";
import {IOwnerManager} from "@safe/interfaces/IOwnerManager.sol";
import {IFallbackManager} from "@safe/interfaces/IFallbackManager.sol";

/// @title SafeAdmin
/// @notice Recovery and admin timelock state for FengceGuard. Every function here is called by the
/// Safe itself (msg.sender is the Safe), through a Safe transaction that FengceGuard has checked.
/// State is keyed by msg.sender, so a non-Safe caller only ever changes its own entries.
///
/// Recovery: `scheduleRecovery` needs signatures from all owners (checked by the guard). After the
/// Safe's recovery delay, `setGuard(0)` and `setModuleGuard(0)` pass. The guard checks recovery
/// before calling any circuit or pin dependency, so a broken circuit cannot lock the Safe.
///
/// Timelock: other admin calls to the Safe (and reconfiguring the guard) must be scheduled here,
/// wait the Safe's admin delay, and are then let through once by the guard.
abstract contract SafeAdmin {
    mapping(address safe => uint256) public recoveryReadyAt;
    mapping(bytes32 id => uint256) public adminReadyAt;

    event RecoveryScheduled(address indexed safe, uint256 readyAt);
    event RecoveryCancelled(address indexed safe);
    event RecoveryExecuted(address indexed safe, bytes4 indexed selector);
    event AdminScheduled(address indexed safe, bytes32 indexed id, address target, bytes data, uint256 readyAt);
    event AdminCancelled(address indexed safe, bytes32 indexed id);
    event AdminExecuted(address indexed safe, bytes32 indexed id);

    error AdminNotAllowed(address target, bytes4 selector);
    error AdminAlreadyScheduled(bytes32 id);
    error AdminNotReady(bytes32 id);
    error RecoveryNotReady(address safe);

    function _recoveryDelay(address safe) internal view virtual returns (uint256);
    function _adminDelay(address safe) internal view virtual returns (uint256);
    function _isGuardConfigCall(bytes memory data) internal view virtual returns (bool);

    // ------------------------------------------------------------------ recovery

    function scheduleRecovery() external {
        uint256 readyAt = block.timestamp + _recoveryDelay(msg.sender);
        recoveryReadyAt[msg.sender] = readyAt;
        emit RecoveryScheduled(msg.sender, readyAt);
    }

    function cancelRecovery() external {
        delete recoveryReadyAt[msg.sender];
        emit RecoveryCancelled(msg.sender);
    }

    function _requireRecovery(address safe, bytes4 selector) internal {
        uint256 r = recoveryReadyAt[safe];
        if (r == 0 || block.timestamp < r) revert RecoveryNotReady(safe);
        // Removing the transaction guard ends recovery; the module guard may be removed first.
        if (selector == IGuardManager.setGuard.selector) delete recoveryReadyAt[safe];
        emit RecoveryExecuted(safe, selector);
    }

    // ------------------------------------------------------------------ timelock

    function adminId(address safe, address target, bytes memory data) public pure returns (bytes32) {
        return keccak256(abi.encode(safe, target, keccak256(data)));
    }

    /// @notice Schedules one admin call. `target` is the Safe itself or this guard (reconfigure).
    function scheduleAdmin(address target, bytes calldata data) external {
        if (!_isTimelockable(msg.sender, target, data)) revert AdminNotAllowed(target, bytes4(data[:4]));
        bytes32 id = adminId(msg.sender, target, data);
        if (adminReadyAt[id] != 0) revert AdminAlreadyScheduled(id);
        uint256 readyAt = block.timestamp + _adminDelay(msg.sender);
        adminReadyAt[id] = readyAt;
        emit AdminScheduled(msg.sender, id, target, data, readyAt);
    }

    function cancelAdmin(address target, bytes calldata data) external {
        bytes32 id = adminId(msg.sender, target, data);
        delete adminReadyAt[id];
        emit AdminCancelled(msg.sender, id);
    }

    function _consumeAdmin(address safe, address target, bytes memory data) internal {
        bytes32 id = adminId(safe, target, data);
        uint256 r = adminReadyAt[id];
        if (r == 0 || block.timestamp < r) revert AdminNotReady(id);
        delete adminReadyAt[id];
        emit AdminExecuted(safe, id);
    }

    /// @dev What may go through the timelock. setGuard(0)/setModuleGuard(0) only go through recovery,
    /// and installing this guard needs no timelock.
    function _isTimelockable(address safe, address target, bytes memory data) internal view returns (bool) {
        if (data.length < 4) return false;
        if (target == address(this)) return _isGuardConfigCall(data);
        if (target != safe) return false;
        bytes4 sel = bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
        if (sel == IGuardManager.setGuard.selector || sel == IModuleManager.setModuleGuard.selector) {
            if (data.length != 36) return false;
            uint256 a;
            assembly {
                a := mload(add(data, 36))
            }
            return a != 0 && a != uint160(address(this)) && a >> 160 == 0;
        }
        return _isAdminSelector(sel);
    }

    function _isAdminSelector(bytes4 sel) internal pure returns (bool) {
        return sel == IModuleManager.enableModule.selector || sel == IModuleManager.disableModule.selector
            || sel == IOwnerManager.addOwnerWithThreshold.selector || sel == IOwnerManager.removeOwner.selector
            || sel == IOwnerManager.swapOwner.selector || sel == IOwnerManager.changeThreshold.selector
            || sel == IFallbackManager.setFallbackHandler.selector;
    }
}
