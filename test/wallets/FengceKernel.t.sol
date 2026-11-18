// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceHook} from "../../src/erc7579/FengceHook.sol";
import {WalletBase, IERC7579Account, PackedUserOperation} from "./WalletBase.sol";

interface IKernelFactory {
    function createAccount(bytes calldata data, bytes32 salt) external payable returns (address);
}

interface IKernel {
    function executeUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash) external payable;
    function changeRootValidator(
        bytes21 rootValidator,
        address hook,
        bytes calldata validatorData,
        bytes calldata hookData
    ) external payable;
}

/// Accepts every user operation; used only to show the changeRootValidator route.
contract OpenValidator {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}

    function isModuleType(uint256 t) external pure returns (bool) {
        return t == 1;
    }

    function isInitialized(address) external pure returns (bool) {
        return true;
    }

    function validateUserOp(PackedUserOperation calldata, bytes32) external payable returns (uint256) {
        return 0;
    }
}

/// FengceHook on ZeroDev Kernel v3.3, live on X Layer (factory, implementation and ECDSA validator as
/// deployed). Every action is a real user operation through the live EntryPoint v0.7, signed by the owner.
/// Kernel attaches hooks to a validation: FengceHook is the root validator's hook, so Kernel runs it on every
/// root user operation (it then requires executeUserOp) with the inner call as msgData.
contract FengceKernelForkTest is WalletBase {
    address constant KERNEL_FACTORY = 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9; // v3.3
    address constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;
    uint256 constant OWNER_KEY = 0xA11CE;

    FengceHook hook;
    address account;

    function setUp() public {
        _forkAndPin();
        hook = new FengceHook(reg, 2_000_000);
        bytes21 root = bytes21(abi.encodePacked(bytes1(0x01), ECDSA_VALIDATOR));
        bytes memory init = abi.encodeWithSignature(
            "initialize(bytes21,address,bytes,bytes,bytes[])",
            root,
            address(hook),
            abi.encodePacked(vm.addr(OWNER_KEY)),
            abi.encodePacked(bytes1(0x00), _hookCfg()), // 1-byte Kernel flag, then the hook's install data
            new bytes[](0)
        );
        account = IKernelFactory(KERNEL_FACTORY).createAccount(init, bytes32(uint256(1)));
        vm.deal(account, 1000);
        assertTrue(hook.isInitialized(account));
    }

    /// A root user operation: executeUserOp wrapping `inner`.
    function _op(bytes memory inner) internal returns (bool) {
        return _handleOp(account, 0, abi.encodePacked(IKernel.executeUserOp.selector, inner), OWNER_KEY);
    }

    function _exec(bytes32 mode, bytes memory data) internal returns (bool) {
        return _op(abi.encodeCall(IERC7579Account.execute, (mode, data)));
    }

    function test_kernelOverLimitBlocked() public {
        assertTrue(_exec(SINGLE, _single(RECIP, 50, "")));
        assertEq(RECIP.balance, 50);
        assertFalse(_exec(SINGLE, _single(RECIP, 150, "")));
        assertEq(RECIP.balance, 50);
    }

    function test_kernelBatchHidingOverLimitBlocked() public {
        assertFalse(_exec(BATCH, _batch2(40, 150)));
        assertEq(RECIP.balance, 0);
        assertTrue(_exec(BATCH, _batch2(40, 40)));
        assertEq(RECIP.balance, 80);
    }

    /// Kernel runs the root hook on uninstallModule, so FengceHook's own delay applies. Kernel also lets the
    /// root validation replace itself (changeRootValidator) with a validation that has no hook; FengceHook
    /// does not check that call, so the hook can be bypassed that way at once (documented gap).
    function test_kernelHookUninstall() public {
        bytes memory deinit = abi.encodePacked(bytes1(0xff)); // ModuleLib passes deInitData to onUninstall
        bytes memory uninstall = abi.encodeCall(IERC7579Account.uninstallModule, (4, address(hook), deinit));

        assertFalse(_op(uninstall)); // HookUninstallNotReady
        assertTrue(hook.isInitialized(account));

        assertTrue(_exec(SINGLE, _single(address(hook), 0, abi.encodeCall(FengceHook.scheduleUninstall, ()))));
        assertFalse(_op(uninstall)); // still inside the delay
        vm.warp(block.timestamp + hook.UNINSTALL_DELAY());
        assertTrue(_op(uninstall));
        assertFalse(hook.isInitialized(account));
    }

    function test_kernelGapChangeRootValidatorDropsHook() public {
        OpenValidator open = new OpenValidator();
        bytes21 newRoot = bytes21(abi.encodePacked(bytes1(0x01), address(open)));
        assertTrue(_op(abi.encodeCall(IKernel.changeRootValidator, (newRoot, address(0), "", ""))));
        // The new root validation has no hook: an over-limit transfer is a plain execute and passes.
        assertTrue(
            _handleOp(account, 0, abi.encodeCall(IERC7579Account.execute, (SINGLE, _single(RECIP, 150, ""))), OWNER_KEY)
        );
        assertEq(RECIP.balance, 150);
    }
}
