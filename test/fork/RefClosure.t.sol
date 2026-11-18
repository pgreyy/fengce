// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {ITapeOutFactory} from "../../src/core/interfaces/ITapeOut.sol";

/// Fork test on live X Layer: pin real circuits that use REF records and check the stored closure
/// against the SDK's independent computation (test/vectors/hashes.json, sdk/scripts/gen-vectors.ts).
contract RefClosureForkTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    PinRegistry reg;
    string json;

    function setUp() public {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        json = vm.readFile("test/vectors/hashes.json");
    }

    function _check(string memory name) internal {
        string memory k = string.concat(".closures.", name);
        address processor = vm.parseJsonAddress(json, string.concat(k, ".processor"));
        uint256 id = vm.parseJsonUint(json, string.concat(k, ".id"));
        bytes32 pinId = reg.pin(processor, id, bytes32(0), bytes32(0));
        assertTrue(reg.isPinned(pinId));
        PinRegistry.CircuitPin memory c = reg.circuitPin(pinId);
        assertTrue(c.refClosureHash != keccak256(""), "closure must not be empty");
        assertEq(c.refClosureHash, vm.parseJsonBytes32(json, string.concat(k, ".refClosureHash")));
        address[] memory expected = vm.parseJsonAddressArray(json, string.concat(k, ".processors"));
        assertEq(c.processors.length, expected.length);
        for (uint256 i; i < expected.length; i++) {
            assertEq(c.processors[i], expected[i]);
        }
    }

    /// 0x99081e…E9A4 #18 -> #11 -> #10: REF two levels deep.
    function test_pinNestedRefCircuit() public {
        _check("nested");
    }

    /// 0xB04EB7…93FF #12: 11 REF records to 3 distinct circuits (duplicates counted once).
    function test_pinRepeatedRefCircuit() public {
        _check("repeated");
    }
}
