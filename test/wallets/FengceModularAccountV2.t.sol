// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceHook6900, ExecutionManifest, IModularAccount6900} from "../../src/erc6900/FengceHook6900.sol";
import {FengceInspector} from "../../src/safe/FengceInspector.sol";
import {WalletBase} from "./WalletBase.sol";

interface IMAv2Factory {
    function createAccount(address owner, uint256 salt, uint32 entityId) external returns (address);
}

interface IMAv2 {
    function installExecution(address module, ExecutionManifest calldata manifest, bytes calldata installData) external;
    function accountId() external view returns (string memory);
}

/// FengceHook6900 on Alchemy Modular Account v2 (ERC-6900 v0.8), live on X Layer (factory and implementation as
/// deployed). The hook is installed with installExecution and the module's own manifest, so it runs on every
/// call to execute, executeBatch, performCreate, upgradeToAndCall and uninstallExecution. Calls come from the
/// EntryPoint address, as in a user operation whose callData is the account call.
contract FengceModularAccountV2ForkTest is WalletBase {
    address constant FACTORY = 0x00000000000017c61b5bEe81050EC8eFc9c6fecd;
    address constant EP = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    FengceHook6900 hook;
    address account;

    function setUp() public {
        _forkAndPin();
        hook = new FengceHook6900(reg, 2_000_000);
        account = IMAv2Factory(FACTORY).createAccount(makeAddr("owner"), 1, 0);
        vm.deal(account, 1000);
        bytes memory cfg = _hookCfg();
        ExecutionManifest memory m = hook.executionManifest();
        vm.prank(EP);
        IMAv2(account).installExecution(address(hook), m, cfg);
        assertTrue(hook.isInitialized(account));
    }

    function _execute(address to, uint256 value) internal {
        vm.prank(EP);
        IModularAccount6900(account).execute(to, value, "");
    }

    function test_mav2OverLimitBlocked() public {
        assertEq(IMAv2(account).accountId(), "alchemy.modular-account.2.0.0");
        _execute(RECIP, 50);
        assertEq(RECIP.balance, 50);
        vm.expectRevert();
        _execute(RECIP, 150);
        assertEq(RECIP.balance, 50);

        // Outcome checks: a FengceInspector listing this module works on a non-Safe account too.
        address[] memory adapters = new address[](1);
        adapters[0] = address(hook);
        FengceInspector inspector = new FengceInspector(adapters);
        address[] memory assets = new address[](1); // address(0) = native balance
        bytes memory set =
            abi.encodeCall(FengceHook6900.setInspector, (address(inspector), abi.encode(assets, new address[](0))));
        vm.prank(EP);
        IModularAccount6900(account).execute(address(hook), 0, set);
        assertEq(hook.inspectorOf(account), address(inspector));
        _execute(RECIP, 30);
        assertEq(RECIP.balance, 80);
    }

    function test_mav2BatchHidingOverLimitBlocked() public {
        IModularAccount6900.Call[] memory calls = new IModularAccount6900.Call[](2);
        calls[0] = IModularAccount6900.Call(RECIP, 40, "");
        calls[1] = IModularAccount6900.Call(RECIP, 150, "");
        vm.prank(EP);
        vm.expectRevert();
        IModularAccount6900(account).executeBatch(calls);
        assertEq(RECIP.balance, 0);

        calls[1].value = 40;
        vm.prank(EP);
        IModularAccount6900(account).executeBatch(calls);
        assertEq(RECIP.balance, 80);
    }

    /// The hook runs on uninstallExecution (and on upgradeToAndCall), so its own delay applies.
    function test_mav2HookUninstall() public {
        ExecutionManifest memory m = hook.executionManifest();
        vm.prank(EP);
        vm.expectRevert();
        IModularAccount6900(account).uninstallExecution(address(hook), m, "");
        vm.prank(EP);
        vm.expectRevert();
        IModularAccount6900(account).upgradeToAndCall(makeAddr("otherImpl"), "");
        assertTrue(hook.isInitialized(account));

        vm.prank(EP);
        IModularAccount6900(account).execute(address(hook), 0, abi.encodeCall(FengceHook6900.scheduleUninstall, ()));
        vm.warp(block.timestamp + hook.UNINSTALL_DELAY());
        vm.prank(EP);
        IModularAccount6900(account).uninstallExecution(address(hook), m, abi.encode(true));
        assertFalse(hook.isInitialized(account));
        _execute(RECIP, 150); // no hook any more
        assertEq(RECIP.balance, 150);
    }
}
