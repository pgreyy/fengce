// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {Schema} from "../src/core/Schema.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";

/// Fork test against live X Layer: pin the one-NAND test circuit and evaluate it.
contract PinNandForkTest is Test {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;
    uint256 constant NAND_ID = 2;

    function test_fork_pinAndEvaluateNand() public {
        vm.createSelectFork("xlayer");
        PinRegistry reg = new PinRegistry(FACTORY);
        PolicyEngine engine = new PolicyEngine(reg, 2_000_000);

        // Layout: bit 0 = "a" (1-bit uint), bit 1 = fixed flag 1.
        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(NAND_CPU).netlist(NAND_ID));
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 1, 0);
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1);

        bytes32 pinId = reg.pin(NAND_CPU, NAND_ID, Schema.hash(l), keccak256("certificate-placeholder"));
        assertTrue(reg.isPinned(pinId), "isPinned");

        // Raw input bytes, LSB first: 0x02 = (a=0, b=1) -> NAND = 1; 0x03 = (1,1) -> 0.
        assertEq(engine.evaluate(pinId, hex"02"), hex"01");
        assertEq(engine.evaluate(pinId, hex"03"), hex"00");

        // Same through the schema; an oversized value for the 1-bit field is rejected, not truncated.
        uint256[] memory v = new uint256[](1);
        assertEq(engine.evaluateFields(pinId, l, v), hex"01");
        v[0] = 2; // raw TapeOut would read only bit 0 (= 0) and allow
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaOverflow.selector, 0, 2, 1));
        engine.evaluateFields(pinId, l, v);
    }
}
