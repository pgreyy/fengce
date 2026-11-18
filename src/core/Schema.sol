// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Schema
/// @notice Strict encoder from typed fields to TapeOut input bytes (TAP-02 section 5: bit i is
/// bit i%8 of byte i/8, least significant bit first).
/// Unlike the processors, which read input leniently, this encoder never truncates: it reverts on a
/// value wider than its field, on input bits no field maps, on overlapping fields, and on a layout
/// whose field widths do not add up to exactly nIn.
library Schema {
    enum Kind {
        Uint, // unsigned integer, 1..256 bits, value must be < 2**width
        Bool, // 1 bit, value must be 0 or 1
        Flag // 1 bit fixed by the schema (fixedValue); takes no caller value
    }

    struct Field {
        Kind kind;
        uint32 offset; // first input bit
        uint32 width; // number of bits
        uint256 fixedValue; // Flag only; must be 0 for other kinds
    }

    struct Layout {
        bytes32 netlistHash; // keccak256 of the circuit netlist this layout is bound to
        uint32 nIn; // circuit input count
        Field[] fields;
    }

    uint256 internal constant MAX_IN = 65_536;

    error SchemaTooManyInputs(uint256 nIn);
    error SchemaBadWidth(uint256 field, uint256 width);
    error SchemaBadFixedValue(uint256 field);
    error SchemaFieldOutOfRange(uint256 field);
    error SchemaWidthMismatch(uint256 sumOfWidths, uint256 nIn);
    error SchemaUnmappedBits(uint256 sumOfWidths, uint256 nIn);
    error SchemaOverlap(uint256 field, uint256 bit);
    error SchemaValueCount(uint256 given, uint256 expected);
    error SchemaOverflow(uint256 field, uint256 value, uint256 width);

    /// @notice Commitment to a layout; this is the `schemaHash` stored in a Pin.
    function hash(Layout memory l) internal pure returns (bytes32) {
        return keccak256(abi.encode(l.netlistHash, l.nIn, l.fields));
    }

    /// @notice Reverts unless the layout maps every input bit exactly once.
    function validate(Layout memory l) internal pure {
        _place(l, new uint256[](0), false);
    }

    /// @notice Encodes one value per non-Flag field, in field order, into exactly ceil(nIn/8) bytes.
    function encode(Layout memory l, uint256[] memory values) internal pure returns (bytes memory) {
        return _place(l, values, true);
    }

    function _place(Layout memory l, uint256[] memory values, bool withValues)
        private
        pure
        returns (bytes memory out)
    {
        uint256 nIn = l.nIn;
        if (nIn > MAX_IN) revert SchemaTooManyInputs(nIn);
        Field[] memory f = l.fields;

        // Shape checks first: widths, ranges, total width, value count.
        uint256 sum;
        uint256 needed;
        for (uint256 k; k < f.length; k++) {
            uint256 w = f[k].width;
            if (f[k].kind == Kind.Uint) {
                if (w == 0 || w > 256) revert SchemaBadWidth(k, w);
                if (f[k].fixedValue != 0) revert SchemaBadFixedValue(k);
                needed++;
            } else {
                if (w != 1) revert SchemaBadWidth(k, w);
                if (f[k].kind == Kind.Bool) {
                    if (f[k].fixedValue != 0) revert SchemaBadFixedValue(k);
                    needed++;
                } else if (f[k].fixedValue > 1) {
                    revert SchemaBadFixedValue(k);
                }
            }
            if (uint256(f[k].offset) + w > nIn) revert SchemaFieldOutOfRange(k);
            sum += w;
        }
        if (sum < nIn) revert SchemaUnmappedBits(sum, nIn);
        if (sum > nIn) revert SchemaWidthMismatch(sum, nIn);
        if (withValues && values.length != needed) revert SchemaValueCount(values.length, needed);

        // Placement: `mask` tracks which bits are taken, so overlaps are caught even for zero values.
        // With no overlap and sum == nIn, every bit is mapped exactly once.
        uint256 nBytes = (nIn + 7) / 8;
        bytes memory mask = new bytes(nBytes);
        out = new bytes(nBytes);
        uint256 vi;
        for (uint256 k; k < f.length; k++) {
            uint256 v;
            if (f[k].kind == Kind.Flag) {
                v = f[k].fixedValue;
            } else if (withValues) {
                v = values[vi++];
                uint256 w = f[k].width;
                if (w < 256 && v >> w != 0) revert SchemaOverflow(k, v, w);
            }
            _write(out, mask, k, f[k].offset, f[k].width, v);
        }
    }

    function _write(bytes memory out, bytes memory mask, uint256 k, uint256 off, uint256 width, uint256 v)
        private
        pure
    {
        for (uint256 b; b < width; b++) {
            uint256 bit = off + b;
            uint256 byteIx = bit >> 3;
            uint8 m = uint8(1 << (bit & 7));
            uint8 taken = uint8(mask[byteIx]);
            if (taken & m != 0) revert SchemaOverlap(k, bit);
            mask[byteIx] = bytes1(taken | m);
            if ((v >> b) & 1 == 1) out[byteIx] = bytes1(uint8(out[byteIx]) | m);
        }
    }
}
