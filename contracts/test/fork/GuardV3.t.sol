// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {Schema} from "../../src/core/Schema.sol";
import {Tick} from "../../src/core/Tick.sol";
import {FengceGuardV3} from "../../src/safe/FengceGuardV3.sol";
import {FengceRulesV3} from "../../src/safe/FengceRulesV3.sol";
import {AgentExecutorV3} from "../../src/safe/AgentExecutorV3.sol";
import {LimitsLib} from "../../script/LimitsLib.sol";
import {V3Lib} from "../../script/V3Lib.sol";
import {ICircuitProcessor, ITransistors} from "../../script/PrepareLimits.s.sol";

interface IFactoryV3 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

interface IERC20V3 {
    function balanceOf(address) external view returns (uint256);
}

/// Fork test on live X Layer: FengceGuardV3 with its rules on TapeOut circuits.
/// - quiet hours, hold lock and agent caps decide on NAND circuit #2 (the deployed max-per-buy circuit and pin);
/// - Tilt-shield counts buys on counter circuit #7 (deployed pins) and keeps the pause in the Tilt-shield latch, taped
///   out here on processor #180 as script/M2Demo.s.sol does on mainnet;
/// - tightening applies at once, loosening waits 1 day.
contract GuardV3ForkTest is Test {
    IFactoryV3 constant FACTORY = IFactoryV3(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    PinRegistry constant REG = PinRegistry(LimitsLib.PIN_REGISTRY);
    Tick constant TICK = Tick(LimitsLib.TICK);

    address owner = makeAddr("owner");
    address partner = makeAddr("partner");
    address agent = makeAddr("agent");
    address payee = makeAddr("payee");
    FengceGuardV3 guard;
    AgentExecutorV3 exec;
    ISafe safe;
    bytes32 maxBuyPin;
    bytes32[] counterPins;
    bytes32 counterNetlistHash;
    bytes32 latchPin;
    bytes32 latchNetlistHash;

    function setUp() public {
        vm.createSelectFork("xlayer");
        string memory j = vm.readFile("../deployments/limits-xlayer-196.json");
        maxBuyPin = vm.parseJsonBytes32(j, ".maxBuyPin");
        counterNetlistHash = vm.parseJsonBytes32(j, ".counterNetlistHash");
        for (uint256 n = 1; n <= 15; n++) {
            counterPins.push(vm.parseJsonBytes32(j, string.concat(".counterPins.", vm.toString(n))));
        }
        _tapeoutLatch();
        guard = new FengceGuardV3(REG, V3Lib.EVAL_GAS_CAP, counterPins, maxBuyPin, TICK);
        exec = new AgentExecutorV3(address(guard));
        bytes memory init = abi.encodeCall(ISafe.setup, (_one(owner), 1, address(0), "", FALLBACK, address(0), 0, payable(address(0))));
        safe = ISafe(payable(FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256("fengce.v3.fork")))));
        deal(LimitsLib.USDT0, address(safe), 20_000_000); // 20 USDT0
    }

    function _one(address a) internal pure returns (address[] memory o) {
        o = new address[](1);
        o[0] = a;
    }

    /// What script/M2Demo.s.sol broadcasts first: mint 6 NAND + 1 LATCH, tape out the latch on processor #180, pin it.
    function _tapeoutLatch() internal {
        bytes memory netlist = vm.parseJsonBytes(vm.readFile("circuits/tilt-latch.json"), ".netlist");
        latchNetlistHash = keccak256(netlist);
        address d = makeAddr("deployer");
        vm.deal(d, 1 ether);
        vm.startPrank(d);
        ICircuitProcessor cpu = ICircuitProcessor(LimitsLib.COUNTER_CPU);
        ITransistors t = ITransistors(cpu.transistorsContract());
        t.mint{value: t.protocolFee()}(t.NAND(), 6);
        t.mint{value: t.protocolFee()}(t.LATCH(), 1);
        uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(netlist, 3, 1);
        latchPin = REG.pin(LimitsLib.COUNTER_CPU, id, Schema.hash(V3Lib.latchLayout(latchNetlistHash)), bytes32(0));
        vm.stopPrank();
    }

    function _params() internal view returns (V3Lib.Install memory p) {
        p.guard = address(guard);
        p.safe = address(safe);
        p.maxPerBuy = 5_000_000; // 5 USDT0
        p.maxBuyPin = maxBuyPin;
        p.tiltAfter = 4;
        p.counterPin = counterPins[2]; // N = 3: the 4th buy in the window trips
        p.counterNetlistHash = counterNetlistHash;
        p.latchPin = latchPin;
        p.latchNetlistHash = latchNetlistHash;
        p.tiltCooldown = 6 hours;
        p.tiltMultX10 = 30;
        p.executor = address(exec);
        p.agent = agent;
        p.agentCapPerDay = 500_000; // 0.5 USDT0
    }

    function _install(V3Lib.Install memory p) internal {
        assertTrue(_exec(LimitsLib.MSCO, V3Lib.installMultiSend(p), Enum.Operation.DelegateCall), "install");
    }

    function _exec(address to, bytes memory data, Enum.Operation op) internal returns (bool) {
        vm.prank(owner);
        return safe.execTransaction(to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), LimitsLib.ownerSignature(owner));
    }

    function _buy(uint256 usdt) internal returns (bool) {
        return _exec(LimitsLib.MSCO, LimitsLib.swapMultiSend(address(safe), LimitsLib.USDT0, LimitsLib.WOKB, usdt, 0), Enum.Operation.DelegateCall);
    }

    function _sell(uint256 wokb) internal returns (bool) {
        return _exec(LimitsLib.MSCO, LimitsLib.swapMultiSend(address(safe), LimitsLib.WOKB, LimitsLib.USDT0, wokb, 0), Enum.Operation.DelegateCall);
    }

    function _refused(uint8 code, address to) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(FengceGuardV3.FengceRefused.selector, code, address(0), to);
    }

    function _expectRefused(uint8 code, address to) internal {
        vm.expectRevert(abi.encodeWithSelector(FengceGuardV3.FengceRefused.selector, code, address(safe), to));
    }

    // ------------------------------------------------------------------ rules on circuits

    function test_quietHours_nandCircuit() public {
        V3Lib.Install memory p = _params();
        uint8 h = uint8((block.timestamp / 1 hours) % 24);
        p.quietOn = true;
        p.quietStart = h;
        p.quietEnd = uint8((h + 1) % 24);
        _install(p);
        _expectRefused(FengceRulesV3.QUIET_HOURS, LimitsLib.ROUTER);
        _buy(200_000);
        // a send is not a swap: quiet hours do not apply
        assertTrue(_exec(LimitsLib.USDT0, abi.encodeWithSignature("transfer(address,uint256)", payee, 100_000), Enum.Operation.Call), "send");
        vm.warp((block.timestamp / 1 hours + 1) * 1 hours); // the next hour is outside the window
        assertTrue(_buy(200_000), "after quiet hours");
    }

    function test_holdLock_nandCircuit() public {
        V3Lib.Install memory p = _params();
        p.holdSeconds = 1 hours;
        _install(p);
        assertTrue(_buy(300_000), "buy");
        uint256 wokb = IERC20V3(LimitsLib.WOKB).balanceOf(address(safe));
        assertGt(wokb, 0);
        _expectRefused(FengceRulesV3.HOLD_LOCK, LimitsLib.ROUTER);
        _sell(wokb);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(_sell(wokb), "sell after the hold");
    }

    function test_tiltShield_counterAndLatchCircuits() public {
        _install(_params());
        // align to the start of a 30-minute window
        vm.warp((block.timestamp / 30 minutes + 1) * 30 minutes);
        for (uint256 i; i < 3; i++) {
            assertTrue(_buy(200_000), "buys 1-3");
        }
        vm.recordLogs();
        assertTrue(_buy(200_000), "4th buy goes through and trips");
        (uint256 trippedAt,,) = _tilt();
        assertEq(trippedAt, block.timestamp, "latch set");
        _expectRefused(FengceRulesV3.TILT_SHIELD, LimitsLib.ROUTER);
        _buy(200_000);
        // sells and sends still work while paused
        assertTrue(_sell(IERC20V3(LimitsLib.WOKB).balanceOf(address(safe)) / 2), "sell while paused");
        assertTrue(_exec(LimitsLib.USDT0, abi.encodeWithSignature("transfer(address,uint256)", payee, 100_000), Enum.Operation.Call), "send");
        vm.warp(block.timestamp + 6 hours); // cooldown over: the latch circuit is cleared by the next buy
        assertTrue(_buy(200_000), "after cooldown");
        (trippedAt,,) = _tilt();
        assertEq(trippedAt, 0);
    }

    function test_tiltShield_sizeTrip_andPartnerClear() public {
        V3Lib.Install memory p = _params();
        p.partner = partner;
        _install(p);
        for (uint256 i; i < 3; i++) {
            vm.warp(block.timestamp + 31 minutes); // separate windows: the count never reaches N
            assertTrue(_buy(200_000), "usual buys");
        }
        vm.warp(block.timestamp + 31 minutes);
        assertTrue(_buy(600_000), "3x the usual goes through and trips");
        _expectRefused(FengceRulesV3.TILT_SHIELD, LimitsLib.ROUTER);
        _buy(200_000);
        vm.prank(partner);
        guard.partnerClearTilt(address(safe));
        assertTrue(_buy(200_000), "partner cleared it");
    }

    function test_agentCap_nandCircuit() public {
        _install(_params());
        bytes memory pay = abi.encodeWithSignature("transfer(address,uint256)", payee, 300_000);
        vm.prank(agent);
        exec.execute(address(safe), LimitsLib.USDT0, 0, pay); // 0.3 of 0.5
        assertEq(IERC20V3(LimitsLib.USDT0).balanceOf(payee), 300_000);
        vm.recordLogs();
        vm.prank(agent);
        exec.execute(address(safe), LimitsLib.USDT0, 0, pay); // 0.6 > 0.5: refused, recorded as Denied
        assertEq(IERC20V3(LimitsLib.USDT0).balanceOf(payee), 300_000, "second payment not made");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory reason;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == AgentExecutorV3.Denied.selector) (,, reason) = abi.decode(logs[i].data, (address, bytes32, bytes));
        }
        assertEq(reason, abi.encodeWithSelector(FengceGuardV3.FengceRefused.selector, FengceRulesV3.AGENT_CAP, address(safe), LimitsLib.USDT0));
        vm.warp(block.timestamp + 1 days); // a new UTC day
        vm.prank(agent);
        exec.execute(address(safe), LimitsLib.USDT0, 0, pay);
        assertEq(IERC20V3(LimitsLib.USDT0).balanceOf(payee), 600_000, "new day");
    }

    function test_maxPerBuy_andRecordRefusal() public {
        _install(_params());
        _expectRefused(FengceRulesV3.CIRCUIT, LimitsLib.USDT0);
        _buy(6_000_000); // over 5: the approve is the first call refused
        bytes memory over = LimitsLib.swapMultiSend(address(safe), LimitsLib.USDT0, LimitsLib.WOKB, 6_000_000, 0);
        vm.expectEmit(true, true, true, true, address(guard));
        emit FengceGuardV3.Refused(address(safe), owner, FengceRulesV3.CIRCUIT, LimitsLib.MSCO, keccak256(over));
        vm.prank(owner);
        guard.recordRefusal(address(safe), LimitsLib.MSCO, 0, over, Enum.Operation.DelegateCall);
    }

    // ------------------------------------------------------------------ timing

    function test_tightenInstant_loosenWaitsOneDay() public {
        V3Lib.Install memory p = _params();
        p.holdSeconds = 1 hours;
        _install(p);
        // tighten: a lower max per buy and a longer hold apply at once
        assertTrue(_exec(address(guard), abi.encodeCall(FengceGuardV3.configure, (_cfg(1_000_000))), Enum.Operation.Call), "lower cap");
        _expectRefused(FengceRulesV3.CIRCUIT, LimitsLib.USDT0);
        _buy(2_000_000);
        p.holdSeconds = 2 hours;
        assertTrue(_exec(address(guard), abi.encodeCall(FengceGuardV3.setRules, (V3Lib.rules(p))), Enum.Operation.Call), "longer hold");
        // loosen: a higher cap must be scheduled and waits 1 day
        bytes memory raise = abi.encodeCall(FengceGuardV3.configure, (_cfg(5_000_000)));
        vm.expectRevert();
        _exec(address(guard), raise, Enum.Operation.Call);
        assertTrue(_exec(address(guard), abi.encodeCall(guard.scheduleAdmin, (address(guard), raise)), Enum.Operation.Call), "schedule");
        vm.warp(block.timestamp + 1 days - 1);
        vm.expectRevert();
        _exec(address(guard), raise, Enum.Operation.Call);
        vm.warp(block.timestamp + 1);
        assertTrue(_exec(address(guard), raise, Enum.Operation.Call), "after 1 day");
        assertTrue(_buy(2_000_000), "2 USDT0 within the raised cap");
    }

    // ------------------------------------------------------------------ helpers

    /// A reconfiguration of a Safe with an enabled module (the agent executor) must accept existing modules.
    function _cfg(uint256 cap) internal view returns (FengceRulesV3.ConfigInput memory c) {
        c = V3Lib.configureInput(cap, maxBuyPin);
        c.acceptExistingModules = true;
    }

    function _tilt() internal view returns (uint256 trippedAt, uint256 usual, uint256 buys) {
        bytes32 base = FengceRulesV3.LOCATION;
        // Store fields: rules(0) caps(1) spent(2) lastBuy(3) trippedAt(4) usual(5) counterN(6)
        trippedAt = uint256(guard.extsload(keccak256(abi.encode(address(safe), uint256(base) + 4))));
        uint256 u = uint256(guard.extsload(keccak256(abi.encode(address(safe), uint256(base) + 5))));
        usual = u & type(uint128).max;
        buys = u >> 128;
    }
}
