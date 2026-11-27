// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {FengceFloors} from "../src/core/FengceFloors.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Fork tests on live X Layer with circuits on processor 0xB04EB7…93FF:
/// team policy = #5 (XOR, built by REF from #1 AND, #2 OR, #3 NAND), a = amount > 200, b = 1 -> allows <= 200;
/// floor = #3 (NAND, inside #5's closure), a = amount > 100, b = 1 -> allows <= 100.
contract FengceFloorsForkTest is ForkBase {
    address constant CPU = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;

    FengceFloors floors;
    address org = makeAddr("org");
    bytes32 teamPin;
    bytes32 floorPin;
    Schema.Layout teamLayout;
    Schema.Layout floorLayout;

    function setUp() public {
        _forkAndPin();
        floors = new FengceFloors(reg, 2_000_000);
        _layout2(teamLayout, 5);
        _layout2(floorLayout, 3);
        teamPin = reg.pin(CPU, 5, Schema.hash(teamLayout), bytes32(0));
        floorPin = reg.pin(CPU, 3, Schema.hash(floorLayout), bytes32(0));
    }

    function _layout2(Schema.Layout storage l, uint256 id) internal {
        l.netlistHash = keccak256(ITapeOutProcessor(CPU).netlist(id));
        l.nIn = 2;
        l.fields.push(Schema.Field(Schema.Kind.Bool, 0, 1, 0));
        l.fields.push(Schema.Field(Schema.Kind.Flag, 1, 1, 1));
    }

    function _cap(uint256 cap) internal pure returns (TxFacts.Binding[] memory b) {
        b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, cap);
    }

    function _teamSafe(bool withFloor) internal returns (ISafe s) {
        s = _newSafe();
        if (withFloor) {
            _exec(s, address(floors), 0, abi.encodeCall(FengceFloors.setFloor, (org, 1 days, floorPin, floorLayout, _cap(100))));
            floors.verifyPolicy(address(s), teamPin);
            _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configureFloors, (address(floors))));
        }
        FengceGuard.ConfigInput memory c = _cfg();
        (c.pinId, c.layout, c.bindings) = (teamPin, teamLayout, _cap(200));
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
    }

    function test_teamAllows150ButFloorDenies() public {
        ISafe noFloor = _teamSafe(false);
        assertTrue(_exec(noFloor, RECIP, 150, "")); // the team policy alone allows 150

        ISafe s = _teamSafe(true);
        vm.expectRevert(abi.encodeWithSelector(FengceFloors.FloorDenied.selector, address(s)));
        _exec(s, RECIP, 150, "");
        assertTrue(_exec(s, RECIP, 50, "")); // floor AND policy allow 50
        assertEq(RECIP.balance, 200);
    }

    function test_floorNotInPolicyClosureRejected() public {
        // The plain NAND circuit used elsewhere does not contain the floor.
        vm.expectRevert(abi.encodeWithSelector(FengceFloors.FloorNotInPolicy.selector, address(this), pinId));
        floors.verifyPolicy(address(this), pinId);
    }

    function test_removingFloorNeedsFloorOwnerAndTimelock() public {
        ISafe s = _teamSafe(true);
        // Explicit times: with the IR pipeline, block.timestamp read again in one test can be the cached value.
        uint256 t0 = block.timestamp;
        // The Safe detaching FengceFloors through its own timelock fails while the floor is set.
        bytes memory detach = abi.encodeCall(FengceGuard.configureFloors, (address(0)));
        _exec(s, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(guard), detach)));
        vm.warp(t0 + DELAY);
        vm.expectRevert(FengceGuard.FengceBadConfig.selector);
        _exec(s, address(guard), 0, detach);
        // Nobody but the floor owner can change the floor.
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FengceFloors.FloorNotOwner.selector, stranger));
        floors.proposeChange(address(s), bytes32(0), floorLayout, _cap(100));

        // The floor owner removes it, after the floor's own delay; then the Safe can detach.
        vm.prank(org);
        floors.proposeChange(address(s), bytes32(0), floorLayout, _cap(100));
        vm.prank(org);
        vm.expectRevert(FengceFloors.FloorNotReady.selector);
        floors.executeChange(address(s), bytes32(0), floorLayout, _cap(100));
        vm.warp(t0 + DELAY + 1 days);
        vm.prank(org);
        floors.executeChange(address(s), bytes32(0), floorLayout, _cap(100));
        assertFalse(floors.hasFloor(address(s)));
        // The earlier refused attempt reverted, so its timelock entry is still there and ready.
        assertTrue(_exec(s, address(guard), 0, detach));
    }
}
