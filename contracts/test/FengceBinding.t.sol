// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {FengceBinding} from "../src/binding/FengceBinding.sol";
import {BoundOnly} from "../src/binding/BoundOnly.sol";
import {BoundVault} from "../src/binding/BoundVault.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Fork tests on live X Layer: a vault that accepts deposits only from Safes bound to the NAND policy
/// with at least 2 days of notice before any change. The Safe's delays: admin 3 days, recovery 3 days.
contract FengceBindingForkTest is ForkBase {
    uint64 constant LONG = 3 days;
    uint256 constant NOTICE = 2 days;

    FengceBinding binding;
    BoundVault vault;
    ISafe safe;
    bytes32 policyHash;

    function setUp() public {
        _forkAndPin();
        binding = new FengceBinding(guard);
        policyHash = binding.policyHashOf(pinId);
        vault = new BoundVault(binding, policyHash, NOTICE);

        safe = _newSafe();
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(vault), BoundVault.deposit.selector, true)));
        FengceGuard.ConfigInput memory c = _cfg();
        (c.adminDelay, c.recoveryDelay) = (LONG, LONG);
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
    }

    function _deposit(uint256 v) internal returns (bool) {
        return _exec(safe, address(vault), v, abi.encodeCall(BoundVault.deposit, ()));
    }

    function test_boundSafeDeposits() public {
        FengceBinding.Policy memory p = binding.policyOf(address(safe));
        assertTrue(p.configured && p.pinned && p.guardInstalled && p.moduleGuardInstalled);
        assertEq(p.policyHash, policyHash);
        assertEq(p.earliestChange, block.timestamp + LONG);
        assertTrue(binding.isBound(address(safe), policyHash, NOTICE));
        assertTrue(_deposit(50));
        assertEq(vault.balanceOf(address(safe)), 50);
        // A different policy hash is not accepted.
        assertFalse(binding.isBound(address(safe), keccak256("other"), NOTICE));
    }

    function test_pendingChangeInsideNoticeWindowFails() public {
        bytes memory change = abi.encodeWithSignature("changeThreshold(uint256)", 1);
        _exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(safe), change)));
        assertTrue(binding.isBound(address(safe), policyHash, NOTICE)); // 3 days away
        vm.warp(block.timestamp + 1 days + 1); // now under 2 days away
        assertFalse(binding.isBound(address(safe), policyHash, NOTICE));
        vm.expectRevert(abi.encodeWithSelector(BoundOnly.NotBound.selector, address(safe), policyHash, NOTICE));
        _deposit(50);
    }

    function test_guardRemovedFails() public {
        _exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleRecovery, ()));
        vm.warp(block.timestamp + LONG);
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0)));
        FengceBinding.Policy memory p = binding.policyOf(address(safe));
        assertFalse(p.guardInstalled);
        assertFalse(binding.isBound(address(safe), policyHash, NOTICE));
        vm.expectRevert(abi.encodeWithSelector(BoundOnly.NotBound.selector, address(safe), policyHash, NOTICE));
        _deposit(50);
    }
}
