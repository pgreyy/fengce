// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {ITapeOutFactory} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";

/// @notice Deterministic deployment of PinRegistry and FengceGuard through the standard CREATE2
/// deployer (0x4e59b44847b379578588920cA78FbF26c0B4956C), SIMULATION ONLY.
///
///   forge script script/Deploy.s.sol --rpc-url xlayer
///
/// This script never calls vm.startBroadcast, so it records no transactions: even with
/// --broadcast nothing is sent. It predicts the addresses, deploys on the simulated chain through the
/// same CREATE2 deployer a real deployment would use, checks the code landed at the predicted
/// addresses, and runs a smoke check (pin the one-NAND test circuit, isPinned). A real deployment is
/// a separate, reviewed step that sends the same two deployer calls.
contract Deploy is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant TAPEOUT_FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;

    bytes32 constant REGISTRY_SALT = keccak256("fengce.PinRegistry.v0.1.0");
    bytes32 constant GUARD_SALT = keccak256("fengce.FengceGuard.v0.1.0");
    uint256 constant EVAL_GAS_CAP = 2_000_000;

    function run() external returns (address registry, address guard) {
        require(block.chainid == 196, "Deploy: X Layer mainnet (196) only");
        require(CREATE2_DEPLOYER.code.length > 0, "Deploy: CREATE2 deployer missing");

        bytes memory regInit = abi.encodePacked(type(PinRegistry).creationCode, abi.encode(TAPEOUT_FACTORY));
        registry = vm.computeCreate2Address(REGISTRY_SALT, keccak256(regInit), CREATE2_DEPLOYER);
        bytes memory guardInit = abi.encodePacked(type(FengceGuard).creationCode, abi.encode(registry, EVAL_GAS_CAP));
        guard = vm.computeCreate2Address(GUARD_SALT, keccak256(guardInit), CREATE2_DEPLOYER);

        console2.log("chainId", block.chainid);
        console2.log("PinRegistry (predicted)", registry);
        console2.log("  salt");
        console2.logBytes32(REGISTRY_SALT);
        console2.log("  initCodeHash");
        console2.logBytes32(keccak256(regInit));
        console2.log("FengceGuard (predicted)", guard);
        console2.log("  salt");
        console2.logBytes32(GUARD_SALT);
        console2.log("  initCodeHash");
        console2.logBytes32(keccak256(guardInit));

        if (registry.code.length > 0) {
            console2.log("PinRegistry already has code at the predicted address; not deploying");
        } else {
            _create2(REGISTRY_SALT, regInit, registry);
        }
        if (guard.code.length > 0) {
            console2.log("FengceGuard already has code at the predicted address; not deploying");
        } else {
            _create2(GUARD_SALT, guardInit, guard);
        }

        // Smoke check on the simulated chain.
        PinRegistry reg = PinRegistry(registry);
        require(address(reg.factory()) == TAPEOUT_FACTORY, "Deploy: wrong factory");
        require(address(FengceGuard(guard).registry()) == registry, "Deploy: guard registry");
        require(FengceGuard(guard).evalGasCap() == EVAL_GAS_CAP, "Deploy: guard gas cap");
        bytes32 pinId = reg.pin(NAND_CPU, 2, bytes32(0), bytes32(0));
        require(reg.isPinned(pinId), "Deploy: smoke pin failed");
        console2.log("smoke check: pinned the one-NAND test circuit, isPinned = true");
        console2.log("SIMULATION ONLY: no transaction was recorded or sent");
    }

    function _create2(bytes32 salt, bytes memory initCode, address expected) private {
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && ret.length == 20, "Deploy: CREATE2 call failed");
        require(address(bytes20(ret)) == expected && expected.code.length > 0, "Deploy: address mismatch");
    }
}
