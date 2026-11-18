// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";

import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Fork tests on live X Layer: minimum delays and the on-chain module check in configure().
contract FengceLimitsForkTest is ForkBase {
    function setUp() public {
        _forkAndPin();
    }

    function _configure(ISafe s, FengceGuard.ConfigInput memory c) internal returns (bool) {
        return _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
    }

    function test_zeroAndBelowFloorDelaysRevert() public {
        ISafe safe = _newSafe();
        FengceGuard.ConfigInput memory c;

        c = _cfg();
        c.recoveryDelay = 0;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 0, 2 days));
        _configure(safe, c);
        c.recoveryDelay = 2 days - 1;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 2 days - 1, 2 days));
        _configure(safe, c);

        c = _cfg();
        c.recoveryWindow = 0;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 0, 1 days));
        _configure(safe, c);
        c.recoveryWindow = 1 days - 1;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 1 days - 1, 1 days));
        _configure(safe, c);

        c = _cfg();
        c.adminDelay = 0;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 0, 1 days));
        _configure(safe, c);
        c.adminDelay = 1 days - 1;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelayTooShort.selector, 1 days - 1, 1 days));
        _configure(safe, c);

        // Exactly at the floors: accepted.
        c = _cfg();
        c.recoveryDelay = 2 days;
        c.recoveryWindow = 1 days;
        c.adminDelay = 1 days;
        assertTrue(_configure(safe, c));
        assertEq(guard.MIN_RECOVERY_DELAY(), 2 days);
        assertEq(guard.MIN_RECOVERY_WINDOW(), 1 days);
        assertEq(guard.MIN_ADMIN_DELAY(), 1 days);
    }

    function test_configureWithModulesRevertsUnlessOverridden() public {
        ISafe safe = _newSafe();
        address m2 = makeAddr("module2");
        _exec(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(this)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", m2));

        FengceGuard.ConfigInput memory c = _cfg(); // built first: _cfg() itself makes an external read
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceModulesEnabled.selector, 2));
        _configure(safe, c);
        assertFalse(guard.configOf(address(safe)).set);

        c.acceptExistingModules = true;
        vm.recordLogs();
        assertTrue(_configure(safe, c));
        assertTrue(guard.configOf(address(safe)).set);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = FengceGuard.ExistingModuleAccepted.selector;
        bool sawThis;
        bool sawM2;
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(guard) || logs[i].topics[0] != topic) continue;
            n++;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(safe));
            address m = abi.decode(logs[i].data, (address));
            if (m == address(this)) sawThis = true;
            if (m == m2) sawM2 = true;
        }
        assertEq(n, 2);
        assertTrue(sawThis && sawM2);
    }
}
