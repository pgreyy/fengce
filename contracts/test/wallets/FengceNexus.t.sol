// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceHook} from "../../src/erc7579/FengceHook.sol";
import {WalletBase, IERC7579Account} from "./WalletBase.sol";

interface INexusFactory {
    function createAccount(bytes calldata initData, bytes32 salt) external payable returns (address payable);
}

interface INexusBootstrap {
    function initNexusWithSingleValidatorNoRegistry(address validator, bytes calldata data) external payable;
}

/// FengceHook on Biconomy Nexus 1.2.0 (Startale's account uses the same base). Nexus is not deployed on X
/// Layer: the canonical factory, implementation, bootstrap and K1 validators' code is read from Base and placed
/// at the same addresses on the X Layer fork, where the circuit lives. Calls come from the EntryPoint address,
/// as in a user operation whose callData is the account call (validation is not part of these tests).
contract FengceNexusForkTest is WalletBase {
    address constant FACTORY = 0x000000001D1D5004a02bAfAb9de2D6CE5b7B13de;
    address constant IMPL = 0x000000004F43C49e93C970E84001853a70923B03; // accountId biconomy.nexus.1.2.0
    address constant BOOTSTRAP = 0x00000000D3254452a909E4eeD47455Af7E27C289;
    address constant K1 = 0x0000000031ef4155C978d48a8A7d4EDba03b04fE; // K1MeeValidator 1.0.3
    address constant DEFAULT_VALIDATOR = 0x00000000d12897DDAdC2044614A9677B191A2d95; // K1MeeValidator 1.0.1, set in IMPL
    address constant EP = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    FengceHook hook;
    address account;

    function setUp() public {
        address[] memory addrs = new address[](5);
        (addrs[0], addrs[1], addrs[2], addrs[3], addrs[4]) = (FACTORY, IMPL, BOOTSTRAP, K1, DEFAULT_VALIDATOR);
        _forkWithBaseCode(addrs);
        hook = new FengceHook(reg, 2_000_000);
        bytes memory boot = abi.encodeCall(
            INexusBootstrap.initNexusWithSingleValidatorNoRegistry, (K1, abi.encodePacked(makeAddr("owner")))
        );
        account = INexusFactory(FACTORY).createAccount(abi.encode(BOOTSTRAP, boot), bytes32(uint256(1)));
        vm.deal(account, 1000);
        bytes memory cfg = _hookCfg();
        vm.prank(EP);
        IERC7579Account(account).installModule(4, address(hook), cfg);
        assertTrue(hook.isInitialized(account));
    }

    function _exec(bytes32 mode, bytes memory data) internal {
        vm.prank(EP);
        IERC7579Account(account).execute(mode, data);
    }

    function test_nexusOverLimitBlocked() public {
        _exec(SINGLE, _single(RECIP, 50, ""));
        assertEq(RECIP.balance, 50);
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookDenied.selector, account, RECIP));
        _exec(SINGLE, _single(RECIP, 150, ""));
        assertEq(RECIP.balance, 50);
    }

    function test_nexusBatchHidingOverLimitBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookDenied.selector, account, RECIP));
        _exec(BATCH, _batch2(40, 150));
        assertEq(RECIP.balance, 0);
        _exec(BATCH, _batch2(40, 40));
        assertEq(RECIP.balance, 80);
    }

    /// Nexus runs the hook on uninstallModule (withHook), so FengceHook's own delay applies.
    function test_nexusHookUninstall() public {
        vm.prank(EP);
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookUninstallNotReady.selector, account));
        IERC7579Account(account).uninstallModule(4, address(hook), "");

        _exec(SINGLE, _single(address(hook), 0, abi.encodeCall(FengceHook.scheduleUninstall, ())));
        vm.warp(block.timestamp + hook.UNINSTALL_DELAY());
        vm.prank(EP);
        IERC7579Account(account).uninstallModule(4, address(hook), "");
        assertFalse(hook.isInitialized(account));
    }
}
