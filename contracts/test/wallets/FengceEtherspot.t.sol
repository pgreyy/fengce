// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceHook} from "../../src/erc7579/FengceHook.sol";
import {WalletBase, IERC7579Account} from "./WalletBase.sol";

interface IEtherspotFactory {
    function createAccount(bytes32 salt, bytes calldata initCode) external payable returns (address);
}

/// FengceHook on Etherspot ModularEtherspotWallet (accountId etherspotwallet.modular.v1.0.0). Not deployed on
/// X Layer: the canonical factory and implementation code (and the factory's stored implementation address) is read from Base and placed at the same addresses on
/// the X Layer fork. The account is created with no bootstrap modules (validation is not part of these tests);
/// calls come from the EntryPoint address.
contract FengceEtherspotForkTest is WalletBase {
    address constant FACTORY = 0x38CC0EDdD3a944CA17981e0A19470d2298B8d43a;
    address constant IMPL = 0x62Fdd1382b0182F2CC40bAdEa6E5DE0CCb2d6488;
    address constant EP = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    FengceHook hook;
    address account;

    function setUp() public {
        address[] memory addrs = new address[](2);
        (addrs[0], addrs[1]) = (FACTORY, IMPL);
        _forkWithBaseCode(addrs);
        vm.store(FACTORY, bytes32(0), bytes32(uint256(uint160(IMPL)))); // factory storage slot 0: implementation
        hook = new FengceHook(reg, 2_000_000);
        // initCode = abi.encode(owner, bootstrap, bootstrapCall); a bootstrap with no code installs nothing.
        account = IEtherspotFactory(FACTORY)
            .createAccount(bytes32(uint256(1)), abi.encode(makeAddr("owner"), address(0), ""));
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

    function test_etherspotOverLimitBlocked() public {
        _exec(SINGLE, _single(RECIP, 50, ""));
        assertEq(RECIP.balance, 50);
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookDenied.selector, account, RECIP));
        _exec(SINGLE, _single(RECIP, 150, ""));
        assertEq(RECIP.balance, 50);
    }

    function test_etherspotBatchHidingOverLimitBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceHook.HookDenied.selector, account, RECIP));
        _exec(BATCH, _batch2(40, 150));
        assertEq(RECIP.balance, 0);
        _exec(BATCH, _batch2(40, 40));
        assertEq(RECIP.balance, 80);
    }

    /// Known gap, recorded as a test: ModularEtherspotWallet's uninstallModule does not run the hook, so
    /// FengceHook's uninstall delay is never consulted; the hook can be removed at once.
    function test_etherspotSkipsHookOnUninstall() public {
        vm.prank(EP);
        IERC7579Account(account).uninstallModule(4, address(hook), "");
        assertFalse(hook.isInitialized(account));
        _exec(SINGLE, _single(RECIP, 150, ""));
        assertEq(RECIP.balance, 150);
    }
}
