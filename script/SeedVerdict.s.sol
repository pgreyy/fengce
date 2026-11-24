// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Schema} from "../src/core/Schema.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {Verdict} from "../src/verdict/Verdict.sol";

interface ICatalogCount {
    function count() external view returns (uint256);
}

/// @notice Creates the demo Verdict market on X Layer mainnet: "Will the Fengce Catalog list at least
/// N policies?", with N = live Catalog.count() + 1, deadline 48 hours out, settle window 1 hour.
/// Rule: the Catalog's comparator listing (processor 0xF9bB…0a0F circuit 7, a >= b on 16 bits), with
/// a = Catalog.count() read at the checkpoint and b = N. Resumable: skips if a market with the same
/// question already exists in this Verdict. Reads the Verdict address from deployments/verdict-xlayer-196.json.
contract SeedVerdict is Script {
    address constant CATALOG = 0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe;
    bytes32 constant CMP_PIN = 0xc9ccba1f2e025335a938f0c0c200c562662d9a75221a1e8ca45fa20b05fe6c91;
    address constant CMP_CPU = 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F;
    uint256 constant CMP_ID = 7;

    function run() external returns (uint256 id) {
        require(block.chainid == 196, "X Layer mainnet only");
        Verdict v = Verdict(vm.parseJsonAddress(vm.readFile("deployments/verdict-xlayer-196.json"), ".Verdict"));
        require(address(v).code.length > 0, "deploy Verdict first");

        uint256 n = ICatalogCount(CATALOG).count() + 1;
        string memory question = string.concat("Will the Fengce Catalog list at least ", vm.toString(n), " policies?");
        for (uint256 i; i < v.marketCount(); i++) {
            if (keccak256(bytes(v.market(i).question)) == keccak256(bytes(question))) {
                console2.log("Demo market already exists:", i);
                return i;
            }
        }

        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(CMP_CPU).netlist(CMP_ID));
        l.nIn = 32;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 16, 0); // a: Catalog.count() at the checkpoint
        l.fields[1] = Schema.Field(Schema.Kind.Uint, 16, 16, 0); // b: N
        Verdict.Input[] memory xs = new Verdict.Input[](2);
        xs[0] = Verdict.Input(CATALOG, abi.encodeCall(ICatalogCount.count, ()), Verdict.Decode.Word, 0);
        xs[1] = Verdict.Input(address(0), "", Verdict.Decode.Constant, n);

        vm.startBroadcast();
        id = v.createMarket(Verdict.NewMarket(question, CMP_PIN, l, xs, uint64(block.timestamp + 48 hours), 1 hours));
        vm.stopBroadcast();
        console2.log("Demo market created:", id);
        console2.log(question);
    }
}
