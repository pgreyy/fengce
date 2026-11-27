// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {IFengcePolicy} from "../core/interfaces/IFengcePolicy.sol";

/// The FengceInspector surface the hook uses (kept as an interface so the hook imports only src/core).
interface IOutcomeInspector {
    function configureFor(address account, bytes calldata data) external;
    function snapshot(address account) external;
    function verify(address account, bool success, address policy) external;
}

/// ERC-7579 module and hook interfaces (module type 4 = hook).
interface IERC7579Module {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
}

interface IERC7579Hook is IERC7579Module {
    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData)
        external
        returns (bytes memory hookData);
    function postCheck(bytes calldata hookData) external;
}

/// @title FengceHook
/// @notice ERC-7579 hook that runs every account execution through a pinned TapeOut circuit, with the
/// same PolicyEngine, Schema and TxFacts as FengceGuard. Imports only src/core.
///
/// Checked: `execute` and `executeFromExecutor` in single and batch call modes; each call is decoded
/// into facts and must be allowed (output bit 0 = 1). Delegatecall, static call and unknown modes are
/// denied, and so is any call to the account itself or to this hook. Uninstalling this hook needs a
/// scheduled uninstall that waited UNINSTALL_DELAY.
///
/// Admin actions that can take an account's executions out of the hook's reach are timelocked one by one:
/// installing or uninstalling a validator, executor or fallback module (types 1 to 3), upgrading the account,
/// and on Kernel v3 changing the root validator or installing or removing validations. The account schedules
/// the exact call with `scheduleAdmin(keccak256(call))`; after ADMIN_DELAY that call passes once. These checks
/// only apply where the account runs the hook on the admin call (Kernel v3 runs the validation hook on every
/// user operation; see docs/WALLETS.md for the other accounts). Installing other hooks is not checked.
contract FengceHook is PolicyEngine, IERC7579Hook, IFengcePolicy {
    uint256 internal constant TYPE_HOOK = 4;
    bytes4 internal constant EXECUTE = 0xe9ae5c53; // execute(bytes32,bytes)
    bytes4 internal constant EXECUTE_FROM_EXECUTOR = 0xd691c964; // executeFromExecutor(bytes32,bytes)
    bytes4 internal constant UNINSTALL_MODULE = 0xa71763a8; // uninstallModule(uint256,address,bytes)
    bytes4 internal constant INSTALL_MODULE = 0x9517e29f; // installModule(uint256,address,bytes)
    bytes4 internal constant UPGRADE_TO = 0x3659cfe6; // upgradeTo(address)
    bytes4 internal constant UPGRADE_TO_AND_CALL = 0x4f1ef286; // upgradeToAndCall(address,bytes)
    // Kernel v3 validation management
    bytes4 internal constant KERNEL_CHANGE_ROOT = 0x52141cd9; // changeRootValidator(bytes21,address,bytes,bytes)
    bytes4 internal constant KERNEL_INSTALL_VALIDATIONS = 0x9198bdf5; // installValidations(bytes21[],(uint32,address)[],bytes[],bytes[])
    bytes4 internal constant KERNEL_UNINSTALL_VALIDATION = 0xe6f3d50a; // uninstallValidation(bytes21,bytes,bytes)
    bytes1 internal constant CALLTYPE_SINGLE = 0x00;
    bytes1 internal constant CALLTYPE_BATCH = 0x01;
    uint256 public constant UNINSTALL_DELAY = 2 days;
    uint256 public constant ADMIN_DELAY = 2 days;

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    struct Config {
        bool set;
        bytes32 pinId;
        bytes32 netlistHash;
        uint32 nIn;
        Schema.Field[] fields;
        TxFacts.Binding[] bindings;
    }

    mapping(address account => Config) internal _configs;
    mapping(address account => uint256) public uninstallReadyAt;
    /// @notice First timestamp at which a scheduled admin call (keccak256 of its calldata) passes, once.
    mapping(address account => mapping(bytes32 callHash => uint256)) public adminReadyAt;
    /// @notice Optional outcome-check contract per account (a FengceInspector that lists this hook as an adapter).
    mapping(address account => address) public inspectorOf;

    /// @notice An account installed the hook with this policy.
    /// @param account The ERC-7579 account
    /// @param pinId Pinned circuit
    event HookInstalled(address indexed account, bytes32 indexed pinId);
    /// @notice An account scheduled removal of the hook.
    /// @param account The ERC-7579 account
    /// @param readyAt First timestamp at which uninstall passes
    event UninstallScheduled(address indexed account, uint256 readyAt);
    /// @notice An account scheduled one admin call.
    /// @param account The ERC-7579 account
    /// @param callHash keccak256 of the admin call's calldata
    /// @param readyAt First timestamp at which it passes
    event AdminScheduled(address indexed account, bytes32 callHash, uint256 readyAt);
    /// @notice The hook was uninstalled from an account.
    /// @param account The ERC-7579 account
    event HookUninstalled(address indexed account);

    error HookDenied(address account, address target);
    error HookNotConfigured(address account);
    error HookBadConfig();
    error HookUnsupportedMode(bytes1 callType, bytes1 execType);
    error HookSelfCall(address target);
    error HookUninstallNotReady(address account);
    error HookAdminNotReady(address account, bytes32 callHash);

    constructor(PinRegistry registry_, uint256 evalGasCap_) PolicyEngine(registry_, evalGasCap_) {}

    // ------------------------------------------------------------------ module lifecycle

    /// @param data abi.encode(bytes32 pinId, Schema.Layout layout, TxFacts.Binding[] bindings)
    function onInstall(bytes calldata data) external override {
        (bytes32 pinId, Schema.Layout memory l, TxFacts.Binding[] memory b) =
            abi.decode(data, (bytes32, Schema.Layout, TxFacts.Binding[]));
        if (!registry.isPinned(pinId)) revert EngineNotPinned(pinId);
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(pinId);
        if (Schema.hash(l) != schemaHash || l.nIn != nIn || l.netlistHash != netlistHash) revert HookBadConfig();
        Schema.validate(l);
        uint256 needed;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (b.length != needed) revert HookBadConfig();
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
        for (uint256 i; i < b.length; i++) {
            c.bindings.push(b[i]);
        }
        delete uninstallReadyAt[msg.sender];
        emit HookInstalled(msg.sender, pinId);
    }

    function onUninstall(bytes calldata) external override {
        delete _configs[msg.sender];
        delete uninstallReadyAt[msg.sender];
        emit HookUninstalled(msg.sender);
    }

    /// @notice Called by the account (an execution to this hook). Uninstall passes after UNINSTALL_DELAY.
    function scheduleUninstall() external {
        uint256 readyAt = block.timestamp + UNINSTALL_DELAY;
        uninstallReadyAt[msg.sender] = readyAt;
        emit UninstallScheduled(msg.sender, readyAt);
    }

    /// @notice Called by the account (an execution to this hook): schedule one admin call (see the contract
    /// notes). `callHash` = keccak256 of the call's calldata, as the account will make it.
    function scheduleAdmin(bytes32 callHash) external {
        uint256 readyAt = block.timestamp + ADMIN_DELAY;
        adminReadyAt[msg.sender][callHash] = readyAt;
        emit AdminScheduled(msg.sender, callHash, readyAt);
    }

    /// @notice Called by the account (an execution to this hook): connect a FengceInspector and set its
    /// watched assets and spenders (`data` = abi.encode(address[] assets, address[] spenders)).
    function setInspector(address inspector, bytes calldata data) external {
        inspectorOf[msg.sender] = inspector;
        if (inspector != address(0)) IOutcomeInspector(inspector).configureFor(msg.sender, data);
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == TYPE_HOOK;
    }

    function isInitialized(address account) external view override returns (bool) {
        return _configs[account].set;
    }

    // ------------------------------------------------------------------ hook

    function preCheck(address, uint256, bytes calldata msgData) external override returns (bytes memory) {
        address account = msg.sender;
        if (msgData.length < 4) return "";
        bytes4 sel = bytes4(msgData[:4]);
        if (sel == EXECUTE || sel == EXECUTE_FROM_EXECUTOR) {
            (bytes32 mode, bytes memory execData) = abi.decode(msgData[4:], (bytes32, bytes));
            _checkExecution(account, mode, execData);
            address i = inspectorOf[account];
            if (i != address(0)) {
                IOutcomeInspector(i).snapshot(account);
                return abi.encode(true);
            }
        } else if (sel == UNINSTALL_MODULE || sel == INSTALL_MODULE) {
            (uint256 moduleType, address module,) = abi.decode(msgData[4:], (uint256, address, bytes));
            if (sel == UNINSTALL_MODULE && moduleType == TYPE_HOOK && module == address(this)) {
                uint256 r = uninstallReadyAt[account];
                if (r == 0 || block.timestamp < r) revert HookUninstallNotReady(account);
            } else if (moduleType >= 1 && moduleType <= 3) {
                _consumeAdmin(account, msgData);
            }
        } else if (
            sel == KERNEL_CHANGE_ROOT || sel == KERNEL_INSTALL_VALIDATIONS || sel == KERNEL_UNINSTALL_VALIDATION
                || sel == UPGRADE_TO || sel == UPGRADE_TO_AND_CALL
        ) {
            _consumeAdmin(account, msgData);
        }
        return "";
    }

    /// @dev Passes a scheduled admin call once, after ADMIN_DELAY.
    function _consumeAdmin(address account, bytes calldata msgData) private {
        bytes32 h = keccak256(msgData);
        uint256 r = adminReadyAt[account][h];
        if (r == 0 || block.timestamp < r) revert HookAdminNotReady(account, h);
        delete adminReadyAt[account][h];
    }

    function postCheck(bytes calldata hookData) external override {
        if (hookData.length == 0) return;
        address i = inspectorOf[msg.sender];
        if (i != address(0)) IOutcomeInspector(i).verify(msg.sender, true, address(this));
    }

    function _checkExecution(address account, bytes32 mode, bytes memory execData) private view {
        bytes1 callType = mode[0];
        bytes1 execType = mode[1];
        if (callType == CALLTYPE_SINGLE) {
            if (execData.length < 52) revert HookBadConfig();
            address target;
            uint256 value;
            assembly {
                target := shr(96, mload(add(execData, 32)))
                value := mload(add(execData, 52))
            }
            bytes memory callData = new bytes(execData.length - 52);
            for (uint256 i; i < callData.length; i++) {
                callData[i] = execData[52 + i];
            }
            _checkCall(account, target, value, callData);
        } else if (callType == CALLTYPE_BATCH) {
            Execution[] memory xs = abi.decode(execData, (Execution[]));
            for (uint256 i; i < xs.length; i++) {
                _checkCall(account, xs[i].target, xs[i].value, xs[i].callData);
            }
        } else {
            revert HookUnsupportedMode(callType, execType);
        }
    }

    function _checkCall(address account, address target, uint256 value, bytes memory callData) private view {
        if (target == account) revert HookSelfCall(target);
        if (target == address(this)) {
            // The account may call the hook only to schedule its own uninstall or an admin call, or to set its inspector.
            if (callData.length == 4 && bytes4(callData) == this.scheduleUninstall.selector && value == 0) return;
            if (callData.length == 36 && bytes4(callData) == this.scheduleAdmin.selector && value == 0) return;
            if (callData.length >= 4 && bytes4(callData) == this.setInspector.selector && value == 0) return;
            revert HookSelfCall(target);
        }
        _policy(account, TxFacts.decode(account, target, value, callData, false), target);
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
