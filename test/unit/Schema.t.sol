// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Schema} from "../../src/core/Schema.sol";

contract SchemaHarness {
    function encode(Schema.Layout memory l, uint256[] memory v) external pure returns (bytes memory) {
        return Schema.encode(l, v);
    }

    function validate(Schema.Layout memory l) external pure {
        Schema.validate(l);
    }
}

contract SchemaTest is Test {
    SchemaHarness h = new SchemaHarness();

    function _l(uint32 nIn, Schema.Field[] memory f) internal pure returns (Schema.Layout memory l) {
        l.netlistHash = keccak256("netlist");
        l.nIn = nIn;
        l.fields = f;
    }

    function _f1(Schema.Kind k, uint32 off, uint32 w, uint256 fixedV) internal pure returns (Schema.Field[] memory f) {
        f = new Schema.Field[](1);
        f[0] = Schema.Field(k, off, w, fixedV);
    }

    function _f2(Schema.Field memory a, Schema.Field memory b) internal pure returns (Schema.Field[] memory f) {
        f = new Schema.Field[](2);
        f[0] = a;
        f[1] = b;
    }

    function _v(uint256 a) internal pure returns (uint256[] memory v) {
        v = new uint256[](1);
        v[0] = a;
    }

    function test_encodesLsbFirstWithFlags() public view {
        Schema.Layout memory l = _l(
            12, _f2(Schema.Field(Schema.Kind.Uint, 0, 11, 0), Schema.Field(Schema.Kind.Flag, 11, 1, 1))
        );
        assertEq(h.encode(l, _v(0x2bc)), hex"bc0a"); // 0x2bc | 1 << 11 = 0xabc
    }

    /// The truncation bug: a raw TapeOut processor reads only the low bits of a field (bits beyond
    /// nIn are ignored), so a naively packed 17 in a 4-bit field is read as 1. Schema refuses it.
    function test_truncationBug_oversizedValueRejected() public {
        bytes memory naive = abi.encodePacked(uint8(17)); // what a careless encoder sends
        assertEq(uint8(naive[0]) & 0x0f, 1); // what the processor reads for a 4-input circuit
        Schema.Layout memory l = _l(4, _f1(Schema.Kind.Uint, 0, 4, 0));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaOverflow.selector, 0, 17, 4));
        h.encode(l, _v(17));
        assertEq(h.encode(l, _v(15)), hex"0f");
    }

    function test_boolMustBe0or1() public {
        Schema.Layout memory l = _l(1, _f1(Schema.Kind.Bool, 0, 1, 0));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaOverflow.selector, 0, 2, 1));
        h.encode(l, _v(2));
    }

    function test_rejectsBadLayouts() public {
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaTooManyInputs.selector, 65_537));
        h.validate(_l(65_537, new Schema.Field[](0)));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaBadWidth.selector, 0, 0));
        h.validate(_l(1, _f1(Schema.Kind.Uint, 0, 0, 0)));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaBadWidth.selector, 0, 257));
        h.validate(_l(300, _f1(Schema.Kind.Uint, 0, 257, 0)));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaBadWidth.selector, 0, 2));
        h.validate(_l(2, _f1(Schema.Kind.Bool, 0, 2, 0)));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaBadFixedValue.selector, 0));
        h.validate(_l(1, _f1(Schema.Kind.Flag, 0, 1, 2)));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaBadFixedValue.selector, 0));
        h.validate(_l(1, _f1(Schema.Kind.Uint, 0, 1, 1)));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaFieldOutOfRange.selector, 0));
        h.validate(_l(4, _f1(Schema.Kind.Uint, 1, 4, 0)));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaUnmappedBits.selector, 3, 4));
        h.validate(_l(4, _f1(Schema.Kind.Uint, 0, 3, 0)));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaWidthMismatch.selector, 6, 4));
        h.validate(_l(4, _f2(Schema.Field(Schema.Kind.Uint, 0, 4, 0), Schema.Field(Schema.Kind.Uint, 2, 2, 0))));

        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaOverlap.selector, 1, 1));
        h.validate(_l(4, _f2(Schema.Field(Schema.Kind.Uint, 0, 2, 0), Schema.Field(Schema.Kind.Uint, 1, 2, 0))));
    }

    function test_valueCountMustMatchNonFlagFields() public {
        Schema.Layout memory l = _l(2, _f2(Schema.Field(Schema.Kind.Bool, 0, 1, 0), Schema.Field(Schema.Kind.Flag, 1, 1, 1)));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaValueCount.selector, 0, 1));
        h.encode(l, new uint256[](0));
        vm.expectRevert(abi.encodeWithSelector(Schema.SchemaValueCount.selector, 2, 1));
        h.encode(l, new uint256[](2));
    }

    /// Fuzz: a uint field either rejects the value (it does not fit) or encodes it exactly.
    function testFuzz_uintRoundTripOrReject(uint256 v, uint16 width) public {
        uint32 w = uint32(bound(width, 1, 256));
        Schema.Layout memory l = _l(w, _f1(Schema.Kind.Uint, 0, w, 0));
        if (w < 256 && v >> w != 0) {
            vm.expectRevert(abi.encodeWithSelector(Schema.SchemaOverflow.selector, 0, v, w));
            h.encode(l, _v(v));
            return;
        }
        bytes memory out = h.encode(l, _v(v));
        assertEq(out.length, (uint256(w) + 7) / 8);
        uint256 back;
        for (uint256 i; i < out.length; i++) {
            back |= uint256(uint8(out[i])) << (8 * i);
        }
        assertEq(back, v);
    }

    /// Fuzz: two adjacent uint fields of random widths pack without interfering.
    function testFuzz_twoFieldsIndependent(uint256 a, uint256 b, uint8 wa, uint8 wb) public view {
        uint32 x = uint32(bound(wa, 1, 64));
        uint32 y = uint32(bound(wb, 1, 64));
        a = bound(a, 0, (uint256(1) << x) - 1);
        b = bound(b, 0, (uint256(1) << y) - 1);
        Schema.Layout memory l = _l(x + y, _f2(Schema.Field(Schema.Kind.Uint, 0, x, 0), Schema.Field(Schema.Kind.Uint, x, y, 0)));
        uint256[] memory v = new uint256[](2);
        v[0] = a;
        v[1] = b;
        bytes memory out = h.encode(l, v);
        uint256 back;
        for (uint256 i; i < out.length; i++) {
            back |= uint256(uint8(out[i])) << (8 * i);
        }
        assertEq(back, a | (b << x));
    }
}
