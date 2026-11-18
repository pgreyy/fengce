// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {Schema} from "../../src/core/Schema.sol";
import {ITapeOutFactory} from "../../src/core/interfaces/ITapeOut.sol";
import {MockBeacon, MockFactory, MockImpl, MockProcessor, NetlistBytes as NB} from "./mocks/TapeOutMocks.sol";

contract PolicyEngineTest is Test {
    MockFactory factory;
    MockProcessor p;
    PinRegistry reg;
    PolicyEngine engine;
    bytes32 pinId;
    Schema.Layout layout;

    function setUp() public {
        MockBeacon beacon = new MockBeacon();
        beacon.set(address(new MockImpl()));
        factory = new MockFactory(address(beacon));
        p = new MockProcessor(address(beacon));
        factory.setCPU(address(p), true);
        bytes memory nl = abi.encodePacked(NB.nand(2, 3), NB.nand(4, 4), NB.nand(5, 5));
        p.set(1, nl, 2, 1);
        reg = new PinRegistry(ITapeOutFactory(address(factory)));
        engine = new PolicyEngine(reg, 1_000_000);
        layout.netlistHash = keccak256(nl);
        layout.nIn = 2;
        layout.fields.push(Schema.Field(Schema.Kind.Bool, 0, 1, 0));
        layout.fields.push(Schema.Field(Schema.Kind.Flag, 1, 1, 1));
        pinId = reg.pin(address(p), 1, Schema.hash(layout), 0);
    }

    function test_evaluates() public view {
        assertEq(engine.evaluate(pinId, hex"02"), hex"01");
        assertEq(engine.evaluate(pinId, hex"03"), hex"00");
        uint256[] memory v = new uint256[](1);
        assertEq(engine.evaluateFields(pinId, layout, v), hex"01");
    }

    function test_inputMustBeExactLengthWithZeroPadding() public {
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineInputLength.selector, 2, 1));
        engine.evaluate(pinId, hex"0200");
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineInputLength.selector, 0, 1));
        engine.evaluate(pinId, "");
        vm.expectRevert(PolicyEngine.EngineInputPadding.selector);
        engine.evaluate(pinId, hex"06"); // bit 2 set, but nIn = 2
    }

    function test_outputMustBeExactLengthWithZeroPadding() public {
        p.setOut(1, hex"0100", false);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineOutputLength.selector, 2, 1));
        engine.evaluate(pinId, hex"02");
        p.setOut(1, "", false);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineOutputLength.selector, 0, 1));
        engine.evaluate(pinId, hex"02");
        p.setOut(1, hex"03", false);
        vm.expectRevert(PolicyEngine.EngineOutputPadding.selector);
        engine.evaluate(pinId, hex"02");
    }

    function test_failsClosed() public {
        p.setOut(1, "", true);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineEvalFailed.selector, pinId));
        engine.evaluate(pinId, hex"02");

        factory.setCPU(address(p), false);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineNotPinned.selector, pinId));
        engine.evaluate(pinId, hex"02");
    }

    function test_evaluateFieldsRequiresThePinnedSchema() public {
        Schema.Layout memory other = layout;
        other.fields = new Schema.Field[](2);
        other.fields[0] = Schema.Field(Schema.Kind.Flag, 0, 1, 1);
        other.fields[1] = Schema.Field(Schema.Kind.Bool, 1, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineSchemaMismatch.selector, pinId));
        engine.evaluateFields(pinId, other, new uint256[](1));
    }
}
