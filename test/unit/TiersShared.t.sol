// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Catalog} from "../../src/core/Catalog.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";

/// The Catalog's on-chain tier thresholds must equal sdk/src/tiers.json, which sdk/src/tiers.ts imports.
contract TiersSharedTest is Test {
    function test_thresholdsMatchSharedConfig() public {
        Catalog c = new Catalog(PinRegistry(address(1)), 1, address(2));
        string memory json = vm.readFile("sdk/src/tiers.json");
        assertEq(c.GREEN_MAX_GAS(), vm.parseJsonUint(json, ".greenMaxGas"));
        assertEq(c.AMBER_MAX_GAS(), vm.parseJsonUint(json, ".amberMaxGas"));
        assertEq(uint256(c.tierFor(c.GREEN_MAX_GAS())), uint256(Catalog.Tier.Green));
        assertEq(uint256(c.tierFor(c.GREEN_MAX_GAS() + 1)), uint256(Catalog.Tier.Amber));
        assertEq(uint256(c.tierFor(c.AMBER_MAX_GAS() + 1)), uint256(Catalog.Tier.Red));
    }
}
