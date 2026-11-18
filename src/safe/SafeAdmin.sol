// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IGuardManager} from "@safe/interfaces/IGuardManager.sol";
import {IModuleManager} from "@safe/interfaces/IModuleManager.sol";
import {IOwnerManager} from "@safe/interfaces/IOwnerManager.sol";
import {IFallbackManager} from "@safe/interfaces/IFallbackManager.sol";
import {ISignatureVerifierMuxer} from "@safe/handler/extensible/SignatureVerifierMuxer.sol";
import {IFallbackHandler} from "@safe/handler/extensible/FallbackHandler.sol";
import {IERC165Handler} from "@safe/handler/extensible/ERC165Handler.sol";

/// @title SafeAdmin
/// @notice Recovery and admin timelock state for FengceGuard. Every function here is called by the
/// Safe itself (msg.sender is the Safe), through a Safe transaction that FengceGuard has checked.
/// State is keyed by msg.sender, so a non-Safe caller only ever changes its own entries.
///
/// Recovery: `scheduleRecovery` needs signatures from all owners (checked by the guard). Between
/// the end of the Safe's recovery delay and the end of its recovery window, `setGuard(x)` and
/// `setModuleGuard(x)` pass for any x other than this guard. After the window it must be scheduled
/// again. The guard checks recovery before calling any circuit or pin dependency, so a broken
/// circuit cannot lock the Safe.
///
/// Timelock: the other admin calls to the Safe, and guard reconfiguration, must be scheduled here,
/// wait the Safe's admin delay, and are then let through once by the guard.
abstract contract SafeAdmin {
    mapping(address safe => uint256) public recoveryReadyAt;
    mapping(address safe => uint256) public recoveryExpiresAt;
    mapping(bytes32 id => uint256) public adminReadyAt;

    /// @notice A Safe scheduled recovery (signed by all owners).
    /// @param safe The Safe
    /// @param readyAt First timestamp at which a guard change is allowed
    /// @param expiresAt Timestamp from which recovery has expired
    event RecoveryScheduled(address indexed safe, uint256 readyAt, uint256 expiresAt);
    /// @notice A Safe cancelled its scheduled recovery.
    /// @param safe The Safe
    event RecoveryCancelled(address indexed safe);
    /// @notice A guard change went through under recovery.
    /// @param safe The Safe
    /// @param selector setGuard or setModuleGuard
    /// @param newGuard The guard being installed (zero to remove)
    event RecoveryExecuted(address indexed safe, bytes4 indexed selector, address newGuard);
    /// @notice A Safe scheduled a timelocked admin call.
    /// @param safe The Safe
    /// @param id Timelock entry id (adminId(safe, target, data))
    /// @param target The Safe itself or this guard
    /// @param data Full calldata of the scheduled call
    /// @param readyAt First timestamp at which it can execute
    event AdminScheduled(address indexed safe, bytes32 indexed id, address target, bytes data, uint256 readyAt);
    /// @notice A Safe cancelled a timelocked admin call.
    /// @param safe The Safe
    /// @param id Timelock entry id
    event AdminCancelled(address indexed safe, bytes32 indexed id);
    /// @notice A timelocked admin call was let through (and consumed).
    /// @param safe The Safe
    /// @param id Timelock entry id
    event AdminExecuted(address indexed safe, bytes32 indexed id);

    error AdminNotAllowed(address target, bytes4 selector);
    error AdminAlreadyScheduled(bytes32 id);
    error AdminNotReady(bytes32 id);
    error RecoveryNotReady(address safe);
    error RecoveryExpired(address safe);

    function _recoveryDelay(address safe) internal view virtual returns (uint256);
    function _recoveryWindow(address safe) internal view virtual returns (uint256);
    function _adminDelay(address safe) internal view virtual returns (uint256);
    function _isGuardConfigCall(bytes memory data) internal view virtual returns (bool);

    // ------------------------------------------------------------------ recovery

    function scheduleRecovery() external {
        uint256 readyAt = block.timestamp + _recoveryDelay(msg.sender);
        uint256 expiresAt = readyAt + _recoveryWindow(msg.sender);
        recoveryReadyAt[msg.sender] = readyAt;
        recoveryExpiresAt[msg.sender] = expiresAt;
        emit RecoveryScheduled(msg.sender, readyAt, expiresAt);
    }

    function cancelRecovery() external {
        delete recoveryReadyAt[msg.sender];
        delete recoveryExpiresAt[msg.sender];
        emit RecoveryCancelled(msg.sender);
    }

    function _requireRecovery(address safe, bytes4 selector, address newGuard) internal {
        uint256 r = recoveryReadyAt[safe];
        if (r == 0 || block.timestamp < r) revert RecoveryNotReady(safe);
        if (block.timestamp >= recoveryExpiresAt[safe]) revert RecoveryExpired(safe);
        // Replacing the transaction guard ends recovery; the module guard may be replaced first.
        if (selector == IGuardManager.setGuard.selector) {
            delete recoveryReadyAt[safe];
            delete recoveryExpiresAt[safe];
        }
        emit RecoveryExecuted(safe, selector, newGuard);
    }

    // ------------------------------------------------------------------ timelock

    /// keccak256("installModule(uint256,address,bytes)"), on Safe7579 (ERC-7579)
    bytes4 internal constant ERC7579_INSTALL = 0x9517e29f;
    /// keccak256("uninstallModule(uint256,address,bytes)"), on Safe7579 (ERC-7579)
    bytes4 internal constant ERC7579_UNINSTALL = 0xa71763a8;

    /// @notice Timelock entry id. For ERC-7579 installModule / uninstallModule calls to the Safe the id
    /// covers (install or uninstall, module type, module) and not the init data, so the same schedule
    /// matches the change whether an owner transaction or a validator-approved user operation makes it.
    function adminId(address safe, address target, bytes memory data) public pure returns (bytes32) {
        bytes4 sel = _sel(data);
        if (target == safe && (sel == ERC7579_INSTALL || sel == ERC7579_UNINSTALL) && data.length >= 68) {
            (uint256 moduleType, address module) = _moduleArgs(data);
            return erc7579AdminId(safe, sel == ERC7579_INSTALL, moduleType, module);
        }
        return keccak256(abi.encode(safe, target, keccak256(data)));
    }

    function erc7579AdminId(address safe, bool install, uint256 moduleType, address module) public pure returns (bytes32) {
        return keccak256(abi.encode(safe, "erc7579", install, moduleType, module));
    }

    function _sel(bytes memory data) internal pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(data, 32))
        }
    }

    /// @dev First two arguments (uint256, address) of an ABI call; reverts on a dirty address word.
    function _moduleArgs(bytes memory data) internal pure returns (uint256 moduleType, address module) {
        uint256 m;
        assembly {
            moduleType := mload(add(data, 36))
            m := mload(add(data, 68))
        }
        require(m >> 160 == 0, "bad module");
        module = address(uint160(m));
    }

    /// @notice Schedules one admin call. `target` is the Safe itself or this guard (reconfigure).
    function scheduleAdmin(address target, bytes calldata data) external {
        if (!_isTimelockable(msg.sender, target, data)) {
            revert AdminNotAllowed(target, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
        }
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
        _consumeAdminId(safe, adminId(safe, target, data));
    }

    function _consumeAdminId(address safe, bytes32 id) internal {
        uint256 r = adminReadyAt[id];
        if (r == 0 || block.timestamp < r) revert AdminNotReady(id);
        delete adminReadyAt[id];
        emit AdminExecuted(safe, id);
    }

    /// @dev What may go through the timelock. Guard changes (setGuard / setModuleGuard to anything
    /// but this guard) only go through recovery, and installing this guard needs neither.
    function _isTimelockable(address safe, address target, bytes memory data) internal view returns (bool) {
        if (data.length < 4) return false;
        if (target == address(this)) return _isGuardConfigCall(data);
        if (target != safe) return false;
        bytes4 sel = bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
        return _isAdminSelector(sel);
    }

    function _isAdminSelector(bytes4 sel) internal pure returns (bool) {
        return sel == IModuleManager.enableModule.selector || sel == IModuleManager.disableModule.selector
            || sel == IOwnerManager.addOwnerWithThreshold.selector || sel == IOwnerManager.removeOwner.selector
            || sel == IOwnerManager.swapOwner.selector || sel == IOwnerManager.changeThreshold.selector
            || sel == IFallbackManager.setFallbackHandler.selector
            // Settings of an extensible fallback handler (Safe self-calls forwarded to the handler):
            // which verifier checks which signature domain, custom methods, ERC-165 answers.
            || sel == ISignatureVerifierMuxer.setDomainVerifier.selector || sel == IFallbackHandler.setSafeMethod.selector
            || sel == IERC165Handler.setSupportedInterface.selector
            || sel == IERC165Handler.addSupportedInterfaceBatch.selector
            || sel == IERC165Handler.removeSupportedInterfaceBatch.selector
            // ERC-7579 module changes through the Safe7579 adapter
            || sel == ERC7579_INSTALL || sel == ERC7579_UNINSTALL;
    }
}
