// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Netlist
/// @notice Strict decoder for TapeOut netlist records (TAP-02 section 2).
/// Records: NAND 0x00 a:u24 b:u24 (7 bytes), LATCH 0x01 d:u24 (4 bytes),
/// REF 0x02 cpu:20 id:u64 nIns:u8 nOuts:u8 ins:u24*nIns (31 + 3*nIns bytes). Big-endian.
library Netlist {
    error NetlistTruncated(uint256 at);
    error NetlistBadOpcode(uint256 at, uint8 opcode);

    struct Ref {
        address cpu;
        uint64 id;
        uint8 nIns;
        uint8 nOuts;
    }

    /// @notice Returns every REF record in order. Reverts on an unknown opcode or a truncated record.
    /// Two passes: lengths are validated before anything is allocated (TAP-02 section 7, requirement 2).
    function refs(bytes memory n) internal pure returns (Ref[] memory out) {
        uint256 count = _walk(n, new Ref[](0), false);
        out = new Ref[](count);
        _walk(n, out, true);
    }

    function _walk(bytes memory n, Ref[] memory out, bool fill) private pure returns (uint256 count) {
        uint256 len = n.length;
        uint256 i = 0;
        while (i < len) {
            uint8 op = uint8(n[i]);
            if (op == 0x00) {
                if (len - i < 7) revert NetlistTruncated(i);
                i += 7;
            } else if (op == 0x01) {
                if (len - i < 4) revert NetlistTruncated(i);
                i += 4;
            } else if (op == 0x02) {
                if (len - i < 31) revert NetlistTruncated(i);
                uint8 nIns = uint8(n[i + 29]);
                uint256 recLen = 31 + 3 * uint256(nIns);
                if (len - i < recLen) revert NetlistTruncated(i);
                if (fill) {
                    address cpu;
                    uint64 id;
                    assembly {
                        let p := add(add(n, 32), i)
                        cpu := shr(96, mload(add(p, 1)))
                        id := shr(192, mload(add(p, 21)))
                    }
                    out[count] = Ref(cpu, id, nIns, uint8(n[i + 30]));
                }
                count++;
                i += recLen;
            } else {
                revert NetlistBadOpcode(i, op);
            }
        }
    }
}
