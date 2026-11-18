// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Tick} from "../src/core/Tick.sol";
import {ITapeOutFactory} from "../src/core/interfaces/ITapeOut.sol";

/// Fork test on live X Layer: a "one spend per period" cap with a real stateful circuit.
/// Circuit 0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7 #18: 1 input, 1 state bit, 5 gates, a toggle
/// (new state = state XOR input, output = new state). With input 1 = "spend": from the zero state the
/// first spend is allowed (state becomes 1); the second is denied (Tick keeps state 1); a new period
/// starts from zero again.
contract FengceTickForkTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant TOGGLE_CPU = 0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7;
    uint64 constant PERIOD = 1 hours;
    bytes constant SPEND = hex"01";

    PinRegistry reg;
    Tick tick;
    bytes32 pinId;

    function setUp() public {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        tick = new Tick(reg, 1_000_000);
        pinId = reg.pin(TOGGLE_CPU, 18, bytes32(0), bytes32(0));
        vm.warp((block.timestamp / PERIOD + 1) * PERIOD); // start of a period
        tick.configure(pinId, PERIOD);
    }

    function test_capBlocksSecondSpendInPeriod_allowsAfterReset() public {
        assertEq(tick.advance(pinId, SPEND, 0), hex"01");
        (,,, uint64 nonce, bytes memory state) = tick.policyOf(address(this), pinId);
        assertEq(nonce, 1);
        assertEq(state, hex"01");

        vm.warp(block.timestamp + PERIOD - 1); // same period
        vm.expectRevert(abi.encodeWithSelector(Tick.TickDenied.selector, address(this), pinId));
        tick.advance(pinId, SPEND, 1);
        (,,, nonce, state) = tick.policyOf(address(this), pinId);
        assertEq(nonce, 1); // a deny changes nothing
        assertEq(state, hex"01");

        vm.warp(block.timestamp + 1); // next period: state resets to zero
        assertEq(tick.advance(pinId, SPEND, 1), hex"01");
        (,, uint64 idx, uint64 n2,) = tick.policyOf(address(this), pinId);
        assertEq(n2, 2);
        assertEq(idx, block.timestamp / PERIOD);
    }

    function test_staleNonceAndBadInputRejected_relayerPath() public {
        vm.expectRevert(abi.encodeWithSelector(Tick.TickStale.selector, 5, 0));
        tick.advance(pinId, SPEND, 5);
        vm.expectRevert(Tick.TickBadInput.selector);
        tick.advance(pinId, hex"03", 0); // padding bit set (nIn = 1)

        address relayer = makeAddr("relayer");
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Tick.TickNotRelayer.selector, relayer));
        tick.advanceFor(address(this), pinId, SPEND, 0);
        tick.setRelayer(relayer, true);
        vm.prank(relayer);
        assertEq(tick.advanceFor(address(this), pinId, SPEND, 0), hex"01");
    }

    function test_rejectsStatelessCircuit() public {
        bytes32 nand = reg.pin(0x839bdD6fa7A66416A609A735e11DE5411B98574e, 2, bytes32(0), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(Tick.TickNotStateful.selector, nand));
        tick.configure(nand, PERIOD);
    }
}
