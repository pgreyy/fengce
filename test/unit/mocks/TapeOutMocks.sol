// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal stand-ins for the TapeOut factory, circuit beacon and processors, for unit tests that
/// run without a fork.
contract MockImpl {
    function v() external pure returns (uint256) {
        return 1;
    }
}

contract MockBeacon {
    address public implementation;

    function set(address i) external {
        implementation = i;
    }
}

contract MockFactory {
    mapping(address => bool) public isCPU;
    address public circuitBeacon;

    constructor(address beacon) {
        circuitBeacon = beacon;
    }

    function setCPU(address c, bool v) external {
        isCPU[c] = v;
    }
}

/// A processor whose runtime code embeds `beacon` (as TapeOut beacon proxies do). Circuits are set
/// by the test. `eval` returns the configured output, or by default NAND of input bits 0 and 1,
/// read leniently like TAP-02 (missing bytes are zero, extra bits ignored).
contract MockProcessor {
    address public immutable beacon;

    struct C {
        bytes netlist;
        uint32 nIn;
        uint32 nOut;
        bool hasOut;
        bytes out;
        bool revertEval;
    }

    mapping(uint256 => C) internal cs;

    constructor(address b) {
        beacon = b;
    }

    function set(uint256 id, bytes calldata nl, uint32 nIn, uint32 nOut) external {
        cs[id].netlist = nl;
        cs[id].nIn = nIn;
        cs[id].nOut = nOut;
    }

    function setOut(uint256 id, bytes calldata out, bool revertEval) external {
        cs[id].hasOut = true;
        cs[id].out = out;
        cs[id].revertEval = revertEval;
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(cs[id].nOut != 0, "no circuit");
        return (cs[id].nIn, cs[id].nOut, 0, 1);
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        require(cs[id].nOut != 0, "no circuit");
        return cs[id].netlist;
    }

    function eval(uint256 id, bytes calldata input) external view returns (bytes memory) {
        C storage c = cs[id];
        if (c.revertEval) revert("eval down");
        if (c.hasOut) return c.out;
        uint8 b0 = input.length > 0 ? uint8(input[0]) : 0;
        uint8 a = b0 & 1;
        uint8 bb = (b0 >> 1) & 1;
        bytes memory o = new bytes(1);
        o[0] = bytes1((a & bb) == 1 ? 0 : 1);
        return o;
    }
}

library NetlistBytes {
    function nand(uint24 a, uint24 b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), a, b);
    }

    function latch(uint24 d) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(1), d);
    }

    function ref2(address cpu, uint64 id, uint24 i0, uint24 i1) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(2), cpu, id, uint8(2), uint8(1), i0, i1);
    }
}
