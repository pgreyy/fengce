// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Schema} from "../src/core/Schema.sol";
import {Tick} from "../src/core/Tick.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";

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
    bytes32 group;

    function setUp() public {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        tick = new Tick(reg, 1_000_000);
        pinId = reg.pin(TOGGLE_CPU, 18, Schema.hash(toggleLayout()), bytes32(0));
        vm.warp((block.timestamp / PERIOD + 1) * PERIOD); // start of a period
        group = tick.createGroup(bytes32("cap"), pinId, PERIOD, toggleLayout(), new TxFacts.Binding[](0));
        tick.setMember(group, address(this), true);
    }

    /// The single input is a flag fixed to 1: every advance is one "spend".
    function toggleLayout() internal view returns (Schema.Layout memory l) {
        l.netlistHash = keccak256(ITapeOutProcessor(TOGGLE_CPU).netlist(18));
        l.nIn = 1;
        l.fields = new Schema.Field[](1);
        l.fields[0] = Schema.Field(Schema.Kind.Flag, 0, 1, 1);
    }

    function test_capBlocksSecondSpendInPeriod_allowsAfterReset() public {
        assertEq(tick.advance(group, SPEND, 0), hex"01");
        (,,,, uint64 nonce, bytes memory state) = tick.groupOf(group);
        assertEq(nonce, 1);
        assertEq(state, hex"01");

        vm.warp(block.timestamp + PERIOD - 1); // same period
        vm.expectRevert(abi.encodeWithSelector(Tick.TickDenied.selector, group, address(this)));
        tick.advance(group, SPEND, 1);
        (,,,, nonce, state) = tick.groupOf(group);
        assertEq(nonce, 1); // a deny changes nothing
        assertEq(state, hex"01");

        vm.warp(block.timestamp + 1); // next period: state resets to zero
        assertEq(tick.advance(group, SPEND, 1), hex"01");
        (,,, uint64 idx, uint64 n2,) = tick.groupOf(group);
        assertEq(n2, 2);
        assertEq(idx, block.timestamp / PERIOD);
    }

    function test_staleNonceBadInputNonMemberAndRelayerPath() public {
        vm.expectRevert(abi.encodeWithSelector(Tick.TickStale.selector, 5, 0));
        tick.advance(group, SPEND, 5);
        vm.expectRevert(Tick.TickBadInput.selector);
        tick.advance(group, hex"03", 0); // padding bit set (nIn = 1)

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Tick.TickNotMember.selector, group, stranger));
        tick.advance(group, SPEND, 0);

        address relayer = makeAddr("relayer");
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Tick.TickNotRelayer.selector, relayer));
        tick.advanceFor(address(this), group, SPEND, 0);
        tick.setRelayer(relayer, true);
        vm.prank(relayer);
        assertEq(tick.advanceFor(address(this), group, SPEND, 0), hex"01");
    }

    function test_rejectsStatelessCircuit() public {
        bytes32 nand = reg.pin(0x839bdD6fa7A66416A609A735e11DE5411B98574e, 2, bytes32(0), bytes32(0));
        Schema.Layout memory l = toggleLayout(); // built first: it makes an external read
        vm.expectRevert(abi.encodeWithSelector(Tick.TickNotStateful.selector, nand));
        tick.createGroup(bytes32("nand"), nand, PERIOD, l, new TxFacts.Binding[](0));
    }
}
