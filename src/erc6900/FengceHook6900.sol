// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {IFengcePolicy} from "../core/interfaces/IFengcePolicy.sol";

/// ERC-6900 v0.8 interfaces used here (from erc6900/reference-implementation v0.8.0, kept local so this
/// file imports only src/core).
struct ManifestExecutionFunction {
    bytes4 executionSelector;
    bool skipRuntimeValidation;
    bool allowGlobalValidation;
}

struct ManifestExecutionHook {
    bytes4 executionSelector;
    uint32 entityId;
    bool isPreHook;
    bool isPostHook;
}

struct ExecutionManifest {
    ManifestExecutionFunction[] executionFunctions;
    ManifestExecutionHook[] executionHooks;
    bytes4[] interfaceIds;
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IModule6900 is IERC165 {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function moduleId() external view returns (string memory);
}

interface IExecutionHookModule6900 is IModule6900 {
    function preExecutionHook(uint32 entityId, address sender, uint256 value, bytes calldata data)
        external
        returns (bytes memory);
    function postExecutionHook(uint32 entityId, bytes calldata preExecHookData) external;
}

interface IExecutionModule6900 is IModule6900 {
    function executionManifest() external pure returns (ExecutionManifest memory);
}

/// The account functions this module hooks (ERC-6900 v0.8 IModularAccount and Alchemy Modular Account v2).
interface IModularAccount6900 {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function execute(address target, uint256 value, bytes calldata data) external payable returns (bytes memory);
    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory);
    function performCreate(uint256 value, bytes calldata initCode, bool isCreate2, bytes32 salt)
        external
        payable
        returns (address);
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
    function uninstallExecution(address module, ExecutionManifest calldata manifest, bytes calldata uninstallData)
        external;
}

/// FengceInspector surface (same as FengceHook's).
interface IOutcomeInspector6900 {
    function configureFor(address account, bytes calldata data) external;
    function snapshot(address account) external;
    function verify(address account, bool success, address policy) external;
}

/// @title FengceHook6900
/// @notice ERC-6900 (v0.8) execution hook module that runs every outgoing call of a modular account through a
/// pinned TapeOut circuit, with the same PolicyEngine, Schema and TxFacts as FengceGuard and FengceHook.
///
/// Installed with `installExecution(this, executionManifest(), abi.encode(pinId, layout, bindings))`. The
/// manifest attaches the hook to these account selectors, so it runs on every call to them whatever the
/// caller (EntryPoint, the account itself after `executeUserOp` or `executeWithRuntimeValidation`, or a
/// direct-call validation such as an agent):
/// - `execute`, `executeBatch`: each call is decoded into facts and must be allowed (output bit 0 = 1).
///   Calls to the account itself are denied; the only calls to this module that pass are
///   `scheduleUninstall` and `setInspector`.
/// - `performCreate`: allowed only with value 0 (a created contract cannot spend the account's tokens
///   without an approval, and approvals go through `execute`).
/// - `uninstallExecution` naming this module, and `upgradeToAndCall`: only after a scheduled uninstall
///   waited UNINSTALL_DELAY.
/// Any other selector the hook is attached to is denied (fail closed).
contract FengceHook6900 is PolicyEngine, IExecutionHookModule6900, IExecutionModule6900, IFengcePolicy {
    uint256 public constant UNINSTALL_DELAY = 2 days;
    string public constant MODULE_ID = "fengce.hook-6900.2.0.0";

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
    /// @notice Optional outcome-check contract per account (a FengceInspector that lists this module as an adapter).
    mapping(address account => address) public inspectorOf;

    /// @notice An account installed the module with this policy.
    /// @param account The ERC-6900 account
    /// @param pinId Pinned circuit
    event HookInstalled(address indexed account, bytes32 indexed pinId);
    /// @notice An account scheduled removal of the module (or an upgrade of the account).
    /// @param account The ERC-6900 account
    /// @param readyAt First timestamp at which uninstall or upgrade passes
    event UninstallScheduled(address indexed account, uint256 readyAt);
    /// @notice The module was uninstalled from an account.
    /// @param account The ERC-6900 account
    event HookUninstalled(address indexed account);

    error HookDenied(address account, address target);
    error HookNotConfigured(address account);
    error HookBadConfig();
    error HookSelfCall(address target);
    error HookUninstallNotReady(address account);
    error HookCreateWithValue(address account);
    error HookUnsupportedSelector(bytes4 selector);

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
        delete inspectorOf[msg.sender];
        emit HookUninstalled(msg.sender);
    }

    /// @notice Called by the account (an `execute` to this module). Uninstall and upgrade pass after UNINSTALL_DELAY.
    function scheduleUninstall() external {
        uint256 readyAt = block.timestamp + UNINSTALL_DELAY;
        uninstallReadyAt[msg.sender] = readyAt;
        emit UninstallScheduled(msg.sender, readyAt);
    }

    /// @notice Called by the account (an `execute` to this module): connect a FengceInspector and set its
    /// watched assets and spenders (`data` = abi.encode(address[] assets, address[] spenders)).
    function setInspector(address inspector, bytes calldata data) external {
        inspectorOf[msg.sender] = inspector;
        if (inspector != address(0)) IOutcomeInspector6900(inspector).configureFor(msg.sender, data);
    }

    function isInitialized(address account) external view returns (bool) {
        return _configs[account].set;
    }

    function moduleId() external pure override returns (string memory) {
        return MODULE_ID;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IModule6900).interfaceId
            || interfaceId == type(IExecutionHookModule6900).interfaceId
            || interfaceId == type(IExecutionModule6900).interfaceId;
    }

    /// @notice The manifest to pass to `installExecution` and `uninstallExecution`: pre and post hooks
    /// (entity 0) on execute, executeBatch, performCreate, upgradeToAndCall and uninstallExecution.
    function executionManifest() external pure override returns (ExecutionManifest memory m) {
        bytes4[5] memory sels = [
            IModularAccount6900.execute.selector,
            IModularAccount6900.executeBatch.selector,
            IModularAccount6900.performCreate.selector,
            IModularAccount6900.upgradeToAndCall.selector,
            IModularAccount6900.uninstallExecution.selector
        ];
        m.executionHooks = new ManifestExecutionHook[](5);
        for (uint256 i; i < 5; i++) {
            m.executionHooks[i] = ManifestExecutionHook(sels[i], 0, true, true);
        }
    }

    // ------------------------------------------------------------------ hook

    function preExecutionHook(uint32, address, uint256, bytes calldata data) external override returns (bytes memory) {
        address account = msg.sender;
        if (data.length < 4) revert HookUnsupportedSelector(bytes4(0));
        bytes4 sel = bytes4(data[:4]);
        if (sel == IModularAccount6900.execute.selector) {
            (address target, uint256 value, bytes memory callData) = abi.decode(data[4:], (address, uint256, bytes));
            _checkCall(account, target, value, callData);
        } else if (sel == IModularAccount6900.executeBatch.selector) {
            IModularAccount6900.Call[] memory calls = abi.decode(data[4:], (IModularAccount6900.Call[]));
            for (uint256 i; i < calls.length; i++) {
                _checkCall(account, calls[i].target, calls[i].value, calls[i].data);
            }
        } else if (sel == IModularAccount6900.performCreate.selector) {
            uint256 value = abi.decode(data[4:36], (uint256));
            if (value != 0) revert HookCreateWithValue(account);
            return "";
        } else if (sel == IModularAccount6900.uninstallExecution.selector) {
            address module = abi.decode(data[4:36], (address));
            if (module == address(this)) _requireReleased(account);
            return "";
        } else if (sel == IModularAccount6900.upgradeToAndCall.selector) {
            _requireReleased(account);
            return "";
        } else {
            revert HookUnsupportedSelector(sel);
        }
        address i = inspectorOf[account];
        if (i != address(0)) {
            IOutcomeInspector6900(i).snapshot(account);
            return abi.encode(true);
        }
        return "";
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData) external override {
        if (preExecHookData.length == 0) return;
        address i = inspectorOf[msg.sender];
        if (i != address(0)) IOutcomeInspector6900(i).verify(msg.sender, true, address(this));
    }

    function _requireReleased(address account) private view {
        uint256 r = uninstallReadyAt[account];
        if (r == 0 || block.timestamp < r) revert HookUninstallNotReady(account);
    }

    function _checkCall(address account, address target, uint256 value, bytes memory callData) private view {
        if (target == account) revert HookSelfCall(target);
        if (target == address(this)) {
            if (value == 0 && callData.length == 4 && bytes4(callData) == this.scheduleUninstall.selector) return;
            if (value == 0 && callData.length >= 4 && bytes4(callData) == this.setInspector.selector) return;
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
