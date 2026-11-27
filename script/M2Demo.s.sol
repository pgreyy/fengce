// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Schema} from "../src/core/Schema.sol";
import {Tick} from "../src/core/Tick.sol";
import {FengceGuardV3} from "../src/safe/FengceGuardV3.sol";
import {AgentExecutorV3} from "../src/safe/AgentExecutorV3.sol";
import {OkunLib} from "./OkunLib.sol";
import {V3Lib} from "./V3Lib.sol";
import {ICircuitProcessor, ITransistors} from "./PrepareOkun.s.sol";

interface IFactoryM2 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

interface IERC20M2 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Milestone 2 on mainnet, one step per run (STEP env), driven by scripts/m2-onchain.sh:
///   deploy  tape out and pin the Tilt-shield latch circuit; deploy FengceGuardV3 (+ linked FengceRulesV3) and AgentExecutorV3
///   safe    create a demo Safe owned by the sender and install v3 (max per buy 2 USDT0, 5 trades per clock hour,
///           Tilt-shield 4 buys / 30 min, quiet hours off; with AGENT set, that agent key at 0.5 USDT0 a day)
///   fund    send FUND (default 1.5) USDT0 from the sender to the Safe
///   swap    buy 0.2 USDT0 of OKB (allowed)
///   refuse  record on chain that a 3 USDT0 buy is refused (MAX_PER_BUY), without sending it
///   tilt    4 buys of 0.2 USDT0 in one 30-minute window: the 4th goes through and trips Tilt-shield
///   paused  record on chain that one more buy is refused (TILT_SHIELD)
/// State between steps: STATE env (a JSON file written by the shell script). Prints "M2 <key> <value>" lines.
contract M2Demo is Script {
    IFactoryM2 constant FACTORY = IFactoryM2(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    PinRegistry constant REG = PinRegistry(OkunLib.PIN_REGISTRY);
    uint256 constant BUY = 200_000; // 0.2 USDT0

    function run() external {
        string memory step = vm.envString("STEP");
        bytes32 s = keccak256(bytes(step));
        if (s == keccak256("deploy")) _deploy();
        else if (s == keccak256("safe")) _safe();
        else if (s == keccak256("fund")) _fund();
        else if (s == keccak256("swap")) _swap();
        else if (s == keccak256("refuse")) _refuse(3_000_000, 1);
        else if (s == keccak256("tilt")) _tilt();
        else if (s == keccak256("paused")) _refuse(BUY, 5);
        else revert("unknown STEP");
    }

    // ------------------------------------------------------------------ state

    function _state() internal view returns (string memory) {
        return vm.readFile(vm.envString("STATE"));
    }

    function _addr(string memory k) internal view returns (address) {
        return vm.parseJsonAddress(_state(), string.concat(".", k));
    }

    function _pins() internal view returns (bytes32 maxBuyPin, bytes32[] memory counterPins, bytes32 counterNetlistHash) {
        string memory j = vm.readFile("deployments/okun-xlayer-196.json");
        maxBuyPin = vm.parseJsonBytes32(j, ".maxBuyPin");
        counterNetlistHash = vm.parseJsonBytes32(j, ".counterNetlistHash");
        counterPins = new bytes32[](15);
        for (uint256 n = 1; n <= 15; n++) {
            counterPins[n - 1] = vm.parseJsonBytes32(j, string.concat(".counterPins.", vm.toString(n)));
        }
    }

    // ------------------------------------------------------------------ steps

    function _deploy() internal {
        (bytes32 maxBuyPin, bytes32[] memory counterPins,) = _pins();
        bytes memory netlist = vm.parseJsonBytes(vm.readFile("circuits/tilt-latch.json"), ".netlist");
        ICircuitProcessor cpu = ICircuitProcessor(OkunLib.COUNTER_CPU);
        ITransistors t = ITransistors(cpu.transistorsContract());
        vm.startBroadcast();
        t.mint{value: t.protocolFee()}(t.NAND(), 6);
        t.mint{value: t.protocolFee()}(t.LATCH(), 1);
        uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(netlist, 3, 1);
        bytes32 latchPin = REG.pin(OkunLib.COUNTER_CPU, id, Schema.hash(V3Lib.latchLayout(keccak256(netlist))), bytes32(0));
        FengceGuardV3 guard = new FengceGuardV3(REG, V3Lib.EVAL_GAS_CAP, counterPins, maxBuyPin, Tick(OkunLib.TICK));
        AgentExecutorV3 exec = new AgentExecutorV3(address(guard));
        vm.stopBroadcast();
        require(REG.isPinned(latchPin), "latch not pinned");
        console.log("M2 tiltLatchCircuitId", id);
        console.log("M2 tiltLatchPin", vm.toString(latchPin));
        console.log("M2 tiltLatchNetlistHash", vm.toString(keccak256(netlist)));
        console.log("M2 guard", address(guard));
        console.log("M2 agentExecutor", address(exec));
    }

    function _safe() internal {
        (bytes32 maxBuyPin, bytes32[] memory counterPins, bytes32 counterNetlistHash) = _pins();
        address guard = _addr("guard");
        address owner = msg.sender;
        bytes memory init = abi.encodeCall(ISafe.setup, (_one(owner), 1, address(0), "", FALLBACK, address(0), 0, payable(address(0))));
        vm.startBroadcast();
        address safe = FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256(abi.encode("fengce.m2.demo", block.timestamp))));
        V3Lib.Install memory p;
        p.guard = guard;
        p.safe = safe;
        p.maxPerBuy = 2_000_000; // 2 USDT0
        p.maxBuyPin = maxBuyPin;
        p.tradesPerHour = 5;
        p.tradesPin = counterPins[4];
        p.tiltAfter = 4;
        p.counterPin = counterPins[2]; // N = 3: the 4th buy in the window trips
        p.counterNetlistHash = counterNetlistHash;
        p.latchPin = vm.parseJsonBytes32(_state(), ".tiltLatchPin");
        p.latchNetlistHash = vm.parseJsonBytes32(_state(), ".tiltLatchNetlistHash");
        p.tiltCooldown = 6 hours;
        p.tiltMultX10 = 30;
        address agent = vm.envOr("AGENT", address(0));
        if (agent != address(0)) {
            p.executor = _addr("agentExecutor");
            p.agent = agent;
            p.agentCapPerDay = 500_000; // 0.5 USDT0
        }
        bool ok = ISafe(payable(safe)).execTransaction(
            OkunLib.MSCO, 0, V3Lib.installMultiSend(p), Enum.Operation.DelegateCall, 0, 0, 0, address(0), payable(address(0)), OkunLib.ownerSignature(owner)
        );
        vm.stopBroadcast();
        require(ok, "install");
        console.log("M2 safe", safe);
        console.log("M2 owner", owner);
        if (agent != address(0)) console.log("M2 agent", agent);
    }

    function _fund() internal {
        address safe = _addr("safe");
        uint256 amount = vm.envOr("FUND", uint256(1_500_000));
        vm.startBroadcast();
        require(IERC20M2(OkunLib.USDT0).transfer(safe, amount), "fund");
        vm.stopBroadcast();
        console.log("M2 funded", amount);
    }

    function _exec(address safe, bytes memory data) internal returns (bool) {
        return ISafe(payable(safe)).execTransaction(
            OkunLib.MSCO, 0, data, Enum.Operation.DelegateCall, 0, 0, 0, address(0), payable(address(0)), OkunLib.ownerSignature(msg.sender)
        );
    }

    function _swap() internal {
        address safe = _addr("safe");
        vm.startBroadcast();
        require(_exec(safe, OkunLib.swapMultiSend(safe, OkunLib.USDT0, OkunLib.WOKB, BUY, 0)), "swap");
        vm.stopBroadcast();
        console.log("M2 swapped", BUY);
    }

    function _tilt() internal {
        address safe = _addr("safe");
        vm.startBroadcast();
        for (uint256 i; i < 4; i++) {
            require(_exec(safe, OkunLib.swapMultiSend(safe, OkunLib.USDT0, OkunLib.WOKB, BUY, 0)), "tilt buy");
        }
        vm.stopBroadcast();
        bytes32 slot = keccak256(abi.encode(safe, uint256(FengceRulesV3Location.LOCATION) + 4));
        uint256 trippedAt = uint256(FengceGuardV3(_addr("guard")).extsload(slot));
        require(trippedAt != 0, "Tilt-shield did not trip");
        console.log("M2 tiltTrippedAt", trippedAt);
    }

    /// Records a refusal on chain (FengceGuardV3.recordRefusal: a dry run that emits Refused with the reason code).
    function _refuse(uint256 amount, uint8 wantCode) internal {
        address safe = _addr("safe");
        FengceGuardV3 guard = FengceGuardV3(_addr("guard"));
        bytes memory buy = OkunLib.swapMultiSend(safe, OkunLib.USDT0, OkunLib.WOKB, amount, 0);
        vm.recordLogs();
        vm.startBroadcast();
        guard.recordRefusal(safe, OkunLib.MSCO, 0, buy, Enum.Operation.DelegateCall);
        vm.stopBroadcast();
        // the simulated run tells which reason was recorded
        uint8 code;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == FengceGuardV3.Refused.selector) code = uint8(uint256(logs[i].topics[3]));
        }
        require(code == wantCode, "unexpected reason code");
        console.log("M2 refusedCode", code);
    }

    function _one(address a) internal pure returns (address[] memory o) {
        o = new address[](1);
        o[0] = a;
    }
}

library FengceRulesV3Location {
    bytes32 internal constant LOCATION = 0x9a57f217486e173034fca5d4a86893cc651eefd65d7136fdc890c40c96dcea92;
}
