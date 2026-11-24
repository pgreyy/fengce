// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Verdict, IERC20Min} from "../src/verdict/Verdict.sol";

/// @notice Deploys Verdict V1 on X Layer mainnet (chain 196) through the CREATE2 deployer, with the v2
/// PinRegistry and USDT0. Resumable: if the CREATE2 address already has code, it is not deployed again.
/// Writes deployments/verdict-xlayer-196.json (address, salt, init code hash, constructor arguments).
/// Simulate: forge script script/DeployVerdict.s.sol --rpc-url https://xlayerrpc.okx.com
contract DeployVerdict is Script {
    address constant CREATE2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant REGISTRY = 0xD905dde3A09a9777B98013AD196E3b3F988e3715; // v2 PinRegistry
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    uint256 constant EVAL_GAS_CAP = 2_000_000;
    string constant VERSION = "v1";

    function run() external returns (address verdict) {
        require(block.chainid == 196, "X Layer mainnet only");
        bytes memory args = abi.encode(REGISTRY, USDT0, EVAL_GAS_CAP);
        bytes memory initCode = abi.encodePacked(type(Verdict).creationCode, args);
        bytes32 salt = keccak256(abi.encodePacked("fengce.Verdict.", VERSION));
        verdict = vm.computeCreate2Address(salt, keccak256(initCode), CREATE2);
        if (verdict.code.length == 0) {
            vm.startBroadcast();
            (bool ok,) = CREATE2.call(abi.encodePacked(salt, initCode));
            vm.stopBroadcast();
            require(ok && verdict.code.length > 0, "Verdict deploy failed");
            console2.log("Verdict deployed at", verdict);
        } else {
            console2.log("Verdict already deployed at", verdict);
        }
        Verdict v = Verdict(verdict);
        require(address(v.registry()) == REGISTRY && address(v.token()) == USDT0, "unexpected Verdict at address");

        string memory k = "verdict";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "Verdict", verdict);
        vm.serializeAddress(k, "PinRegistry", REGISTRY);
        vm.serializeAddress(k, "USDT0", USDT0);
        vm.serializeUint(k, "evalGasCap", EVAL_GAS_CAP);
        vm.serializeBytes32(k, "salt", salt);
        vm.serializeBytes32(k, "initCodeHash", keccak256(initCode));
        vm.serializeBytes(k, "constructorArgs", args);
        string memory out = vm.serializeBytes32(k, "runtimeCodeHash", verdict.codehash);
        vm.writeJson(out, "deployments/verdict-xlayer-196.json");
    }
}
