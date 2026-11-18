// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Netlist} from "../../src/core/Netlist.sol";
import {NetlistBytes as NB} from "./mocks/TapeOutMocks.sol";

contract NetlistHarness {
    function refs(bytes memory n) external pure returns (Netlist.Ref[] memory) {
        return Netlist.refs(n);
    }
}

contract NetlistTest is Test {
    NetlistHarness h = new NetlistHarness();
    address constant CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;

    function test_parsesOnChainNand() public view {
        // circuit #2 on 0x839bdD…574e, read on X Layer
        assertEq(h.refs(hex"000000020000030000000400000400000005000005").length, 0);
    }

    function test_parsesRefFieldsAmongOtherRecords() public view {
        bytes memory n = abi.encodePacked(NB.latch(4), NB.ref2(CPU, 2, 2, 3), NB.nand(5, 6), NB.ref2(address(0xBEEF), 7, 1, 0));
        Netlist.Ref[] memory r = h.refs(n);
        assertEq(r.length, 2);
        assertEq(r[0].cpu, CPU);
        assertEq(r[0].id, 2);
        assertEq(r[0].nIns, 2);
        assertEq(r[0].nOuts, 1);
        assertEq(r[1].cpu, address(0xBEEF));
        assertEq(r[1].id, 7);
    }

    function test_rejectsTruncatedRecords() public {
        vm.expectRevert(abi.encodeWithSelector(Netlist.NetlistTruncated.selector, 0));
        h.refs(hex"000000020000");
        vm.expectRevert(abi.encodeWithSelector(Netlist.NetlistTruncated.selector, 7));
        h.refs(hex"00000002000003010000");
        vm.expectRevert(abi.encodeWithSelector(Netlist.NetlistTruncated.selector, 0));
        h.refs(abi.encodePacked(uint8(2), CPU, uint64(1)));
        // REF header complete but one of its two input indices missing
        vm.expectRevert(abi.encodeWithSelector(Netlist.NetlistTruncated.selector, 0));
        h.refs(abi.encodePacked(uint8(2), CPU, uint64(1), uint8(2), uint8(1), uint24(2)));
    }

    function test_rejectsUnknownOpcode() public {
        vm.expectRevert(abi.encodeWithSelector(Netlist.NetlistBadOpcode.selector, 7, 3));
        h.refs(hex"0000000200000303");
    }

    /// Fuzz: arbitrary bytes either parse or revert with one of the two decoder errors, never
    /// anything else (no panic, no out-of-bounds read).
    function testFuzz_arbitraryBytesFailCleanly(bytes calldata data) public view {
        try h.refs(data) returns (Netlist.Ref[] memory) {}
        catch (bytes memory err) {
            bytes4 sel = bytes4(err);
            assertTrue(sel == Netlist.NetlistTruncated.selector || sel == Netlist.NetlistBadOpcode.selector);
        }
    }

    /// Fuzz: a netlist built from valid records parses back to exactly its REF records.
    function testFuzz_validRecordsRoundTrip(uint256 seed, uint8 count) public view {
        uint256 n = bound(count, 0, 24);
        bytes memory nl;
        uint256 expected;
        address[] memory cpus = new address[](n);
        uint64[] memory ids = new uint64[](n);
        for (uint256 i; i < n; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 kind = r % 3;
            if (kind == 0) {
                nl = abi.encodePacked(nl, NB.nand(uint24(r >> 8), uint24(r >> 32)));
            } else if (kind == 1) {
                nl = abi.encodePacked(nl, NB.latch(uint24(r >> 8)));
            } else {
                address c = address(uint160(r >> 40));
                uint64 id = uint64(r >> 200);
                uint8 nIns = uint8(r >> 16) % 5;
                bytes memory ins;
                for (uint256 k; k < nIns; k++) {
                    ins = abi.encodePacked(ins, uint24(k + 2));
                }
                nl = abi.encodePacked(nl, uint8(2), c, id, nIns, uint8(1), ins);
                cpus[expected] = c;
                ids[expected] = id;
                expected++;
            }
        }
        Netlist.Ref[] memory refs = h.refs(nl);
        assertEq(refs.length, expected);
        for (uint256 i; i < expected; i++) {
            assertEq(refs[i].cpu, cpus[i]);
            assertEq(refs[i].id, ids[i]);
        }
    }
}
