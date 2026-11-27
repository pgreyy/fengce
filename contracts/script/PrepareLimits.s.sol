// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Schema} from "../src/core/Schema.sol";
import {IBeacon} from "../src/core/interfaces/ITapeOut.sol";
import {LimitsLib} from "./LimitsLib.sol";

interface ICircuitProcessor {
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistorsContract() external view returns (address);
    function netlist(uint256 id) external view returns (bytes memory);
}

interface ITransistors {
    function mint(uint256 id, uint256 amount) external payable;
    function protocolFee() external view returns (uint256);
    function balanceOf(address who, uint256 id) external view returns (uint256);
    function NAND() external view returns (uint256);
    function LATCH() external view returns (uint256);
}

/// @notice Prepares the two limits (max per buy, trades per hour) on X Layer mainnet (chain 196). No Fengce contract is deployed.
/// 1. Tapes out the trades-per-hour counter (circuits/trade-counter.json, 100 NAND + 4 LATCH) on processor #180:
///    mints the transistors it burns (mint price 0, protocol fee per mint call), then pays TAPEOUT_FEE.
/// 2. Pins "max per buy": the deployed NAND circuit #2 with the two-flag schema (amount over cap, paying USDT0).
/// 3. Pins the counter once per N = 1..15 (N is part of the schema).
/// Resumable: a step already done on chain (circuit taped out with the same netlist, pin present) is skipped.
/// Writes deployments/limits-xlayer-196.json.
/// Simulate: forge script script/PrepareLimits.s.sol --rpc-url https://xlayerrpc.okx.com --sender <deployer>
contract PrepareLimits is Script {
    string constant OUT = "../deployments/limits-xlayer-196.json";

    function run() external {
        require(block.chainid == 196, "X Layer mainnet only");
        address sender = msg.sender;
        bytes memory netlist = vm.parseJsonBytes(vm.readFile("circuits/trade-counter.json"), ".netlist");
        uint256 nand = vm.parseJsonUint(vm.readFile("circuits/trade-counter.json"), ".gates");
        uint256 latch = vm.parseJsonUint(vm.readFile("circuits/trade-counter.json"), ".latches");
        ICircuitProcessor cpu = ICircuitProcessor(LimitsLib.COUNTER_CPU);
        PinRegistry reg = PinRegistry(LimitsLib.PIN_REGISTRY);

        // 1. Counter circuit
        uint256 id = _existingCircuit(cpu, netlist);
        vm.startBroadcast();
        if (id == 0) {
            ITransistors t = ITransistors(cpu.transistorsContract());
            uint256 fee = t.protocolFee();
            uint256 haveN = t.balanceOf(sender, t.NAND());
            uint256 haveL = t.balanceOf(sender, t.LATCH());
            if (haveN < nand) t.mint{value: fee}(t.NAND(), nand - haveN);
            if (haveL < latch) t.mint{value: fee}(t.LATCH(), latch - haveL);
            id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(netlist, 7, 1);
            console2.log("counter taped out: processor #180 circuit", id);
        } else {
            console2.log("counter already taped out: circuit", id);
        }
        // 2. Max per buy pin
        bytes32 maxBuyPin = _pin(reg, LimitsLib.MAX_BUY_CPU, LimitsLib.MAX_BUY_ID, Schema.hash(LimitsLib.maxBuyLayout()), bytes32(0));
        // 3. Counter pins, N = 1..15
        bytes32[15] memory counterPins;
        bytes32 nh = keccak256(netlist);
        for (uint256 n = 1; n <= 15; n++) {
            counterPins[n - 1] = _pin(reg, LimitsLib.COUNTER_CPU, id, Schema.hash(LimitsLib.counterLayout(nh, n)), bytes32(0));
        }
        vm.stopBroadcast();

        string memory pins = "pins";
        for (uint256 n = 1; n <= 15; n++) {
            pins = vm.serializeBytes32("counterPins", vm.toString(n), counterPins[n - 1]);
        }
        string memory k = "limits";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "counterProcessor", LimitsLib.COUNTER_CPU);
        vm.serializeString(k, "counterCircuitId", vm.toString(id));
        vm.serializeBytes32(k, "counterNetlistHash", nh);
        vm.serializeBytes32(k, "maxBuyPin", maxBuyPin);
        vm.serializeAddress(k, "maxBuyProcessor", LimitsLib.MAX_BUY_CPU);
        vm.serializeUint(k, "maxBuyCircuitId", LimitsLib.MAX_BUY_ID);
        string memory out = vm.serializeString(k, "counterPins", pins);
        vm.writeJson(out, OUT);
        console2.log("wrote", OUT);
    }

    /// The circuit id recorded in a previous run, if it still holds the same netlist on chain; else 0.
    function _existingCircuit(ICircuitProcessor cpu, bytes memory netlist) internal view returns (uint256) {
        try vm.readFile(OUT) returns (string memory j) {
            uint256 id = vm.parseUint(vm.parseJsonString(j, ".counterCircuitId"));
            if (id != 0 && keccak256(cpu.netlist(id)) == keccak256(netlist)) return id;
        } catch {}
        return 0;
    }

    /// Pins (processor, id) with a schema unless that exact pin exists. The id formula is PinRegistry's.
    function _pin(PinRegistry reg, address processor, uint256 id, bytes32 schemaHash, bytes32 cert) internal returns (bytes32 pinId) {
        bytes32 nh = keccak256(ICircuitProcessor(processor).netlist(id));
        address impl = IBeacon(reg.factory().circuitBeacon()).implementation();
        pinId = keccak256(
            abi.encode(PinRegistry.Kind.Circuit, block.chainid, processor, id, nh, keccak256(""), schemaHash, cert, impl)
        );
        if (reg.kindOf(pinId) == PinRegistry.Kind.None) {
            bytes32 got = reg.pin(processor, id, schemaHash, cert);
            require(got == pinId, "pin id formula changed");
        }
    }
}
