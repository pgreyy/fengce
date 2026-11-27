// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Schema} from "../../src/core/Schema.sol";

/// TypeScript vs Solidity: schemaHash of the SDK example schemas (sdk/examples/*.schema.json),
/// computed by the SDK into test/vectors/hashes.json, must equal Schema.hash here.
contract HashVectorsTest is Test {
    function _json() internal view returns (string memory) {
        return vm.readFile("test/vectors/hashes.json");
    }

    function test_schemaHashMatchesSdk_nandLimit() public view {
        Schema.Layout memory l;
        l.netlistHash = 0xc738359c3dde133a010e00bbc3dc1bd8685e3028a04e5df6e0f00cffa2ce2524;
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0);
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1);
        assertEq(Schema.hash(l), vm.parseJsonBytes32(_json(), ".schemas.nand-limit"));
    }

    function test_schemaHashMatchesSdk_comparator16() public view {
        Schema.Layout memory l;
        l.netlistHash = 0x3f79ea6c551d8b2206c10b8a38e6c27ad3f7da332028c32e3c1a25dfe6f31c9f;
        l.nIn = 32;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 16, 0);
        l.fields[1] = Schema.Field(Schema.Kind.Uint, 16, 16, 0);
        assertEq(Schema.hash(l), vm.parseJsonBytes32(_json(), ".schemas.comparator16"));
    }
}
