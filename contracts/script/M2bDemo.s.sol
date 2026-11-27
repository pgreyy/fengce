// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {Catalog} from "../src/core/Catalog.sol";
import {FengceGuardV3} from "../src/safe/FengceGuardV3.sol";
import {FengceRulesV3} from "../src/safe/FengceRulesV3.sol";
import {FengceSetupV3} from "../src/safe/FengceSetupV3.sol";
import {LimitsLib} from "./LimitsLib.sol";
import {V3Lib} from "./V3Lib.sol";
import {ICircuitProcessor, ITransistors} from "./PrepareLimits.s.sol";

interface IFactoryM2b {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
}

interface IERC20M2b {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Milestone 2b on X Layer mainnet, one step per run (STEP env), state in the Milestone 2 JSON (STATE env):
///   setup    deploy FengceSetupV3 (a new Safe gets guard v3 during creation, one signature)
///   fresh    create a second Safe through FengceSetupV3 (max per buy 0.1 USDT0, Tilt-shield on, the deployer as
///            partner), fund it with 0.12 USDT0
///   catalog  on that Safe: Catalog.payInstall for the Catalog's Stablecoin Transfer Limit (circuit #2, cap 0.1 USDT0),
///            schedule the policy change, the partner approves it early, apply; send 0.05 USDT0 (allowed); record that
///            a 0.5 USDT0 send is refused
///   build    tape out a new circuit (4 NAND: refuse when the amount is over 0.1 USDT0 or the token is USDC, as Limits ->
///            Build your own compiles "or"), pin it, schedule, partner approves, apply; send 0.05 USDT0 (allowed);
///            record that a 0.5 USDT0 send is refused
///   hold     on the demo Safe: hold lock 6 hours (tightening, at once), buy 0.05 USDT0 of OKB, record that selling
///            it is refused (HOLD_LOCK)
///   quiet    on the demo Safe: quiet hours over the current UTC hour (tightening, at once), record that a buy is
///            refused (QUIET_HOURS)
/// Prints "M2 key value" lines that scripts/m2b-onchain.sh records.
contract M2bDemo is Script {
    IFactoryM2b constant FACTORY = IFactoryM2b(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    PinRegistry constant REG = PinRegistry(LimitsLib.PIN_REGISTRY);
    Catalog constant CATALOG = Catalog(0x26C5437428cdD7e4854614DC5DDEFE2776B51dFe);
    address constant USDC = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;
    uint256 constant SMALL = 50_000; // 0.05 USDT0
    uint256 constant CAP = 100_000; // 0.1 USDT0, the second Safe's limit
    uint256 constant OVER = 500_000; // 0.5 USDT0, recorded as refused (never sent)
    uint256 constant FUND = 120_000; // 0.12 USDT0 to the second Safe
    /// "or" as Limits -> Build your own compiles it: signals 2 = a, 3 = b; allow = NOR(a, b) in 4 NAND records
    bytes constant OR_NETLIST = hex"00000002000002000000030000030000000400000500000006000006";

    function run() external {
        bytes32 s = keccak256(bytes(vm.envString("STEP")));
        if (s == keccak256("setup")) _setup();
        else if (s == keccak256("fresh")) _fresh();
        else if (s == keccak256("catalog")) _catalog();
        else if (s == keccak256("build")) _build();
        else if (s == keccak256("hold")) _hold();
        else if (s == keccak256("quiet")) _quiet();
        else if (s == keccak256("partner")) _partner();
        else if (s == keccak256("partner2")) _partner2();
        else revert("STEP: setup | fresh | catalog | build | hold | quiet | partner | partner2");
    }

    // ------------------------------------------------------------------ state and helpers

    function _state() internal view returns (string memory) {
        return vm.readFile(vm.envString("STATE"));
    }

    function _addr(string memory k) internal view returns (address) {
        return vm.parseJsonAddress(_state(), string.concat(".", k));
    }

    function _guard() internal view returns (FengceGuardV3) {
        return FengceGuardV3(_addr("guard"));
    }

    function _exec(address safe, address to, bytes memory data, Enum.Operation op) internal returns (bool) {
        return ISafe(payable(safe)).execTransaction(to, 0, data, op, 0, 0, 0, address(0), payable(address(0)), LimitsLib.ownerSignature(msg.sender));
    }

    /// FengceGuardV3.recordRefusal; requires that the guard gives `want` as the reason.
    function _refuse(address safe, address to, bytes memory data, Enum.Operation op, uint8 want) internal returns (uint8 code) {
        vm.recordLogs();
        vm.startBroadcast();
        _guard().recordRefusal(safe, to, 0, data, op);
        vm.stopBroadcast();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == FengceGuardV3.Refused.selector) code = uint8(uint256(logs[i].topics[3]));
        }
        require(code == want, "unexpected reason code");
    }

    /// Schedules `configure(input)`, the partner (the deployer) approves it early, then the Safe applies it.
    function _changePolicy(address safe, FengceRulesV3.ConfigInput memory input) internal {
        FengceGuardV3 g = _guard();
        bytes memory cfg = abi.encodeCall(FengceGuardV3.configure, (input));
        require(_exec(safe, address(g), abi.encodeCall(g.scheduleAdmin, (address(g), cfg)), Enum.Operation.Call), "schedule");
        g.partnerApprove(safe, g.adminId(safe, address(g), cfg));
        require(_exec(safe, address(g), cfg, Enum.Operation.Call), "apply");
    }

    function _input(bytes32 pin, Schema.Layout memory l, TxFacts.Binding[] memory b) internal pure returns (FengceRulesV3.ConfigInput memory c) {
        c.pinId = pin;
        c.layout = l;
        c.bindings = b;
        c.recoveryDelay = LimitsLib.RECOVERY_DELAY;
        c.recoveryWindow = LimitsLib.RECOVERY_WINDOW;
        c.adminDelay = LimitsLib.ADMIN_DELAY;
    }

    function _send(address safe, uint256 amount) internal returns (bool) {
        return _exec(safe, LimitsLib.USDT0, abi.encodeCall(IERC20M2b.transfer, (msg.sender, amount)), Enum.Operation.Call);
    }

    // ------------------------------------------------------------------ steps

    function _setup() internal {
        vm.startBroadcast();
        FengceSetupV3 s = new FengceSetupV3();
        vm.stopBroadcast();
        console.log("M2 setupV3", address(s));
    }

    function _fresh() internal {
        string memory j = vm.readFile("../deployments/limits-xlayer-196.json");
        V3Lib.Install memory p;
        p.guard = _addr("guard");
        p.maxPerBuy = CAP;
        p.maxBuyPin = vm.parseJsonBytes32(j, ".maxBuyPin");
        p.tiltAfter = 4;
        p.counterPin = vm.parseJsonBytes32(j, ".counterPins.3");
        p.counterNetlistHash = vm.parseJsonBytes32(j, ".counterNetlistHash");
        p.latchPin = vm.parseJsonBytes32(_state(), ".tiltLatchPin");
        p.latchNetlistHash = vm.parseJsonBytes32(_state(), ".tiltLatchNetlistHash");
        p.tiltCooldown = 6 hours;
        p.tiltMultX10 = 30;
        p.partner = msg.sender; // the deployer plays the partner in this demo
        address[] memory o = new address[](1);
        o[0] = msg.sender;
        bytes memory init = abi.encodeCall(ISafe.setup, (o, 1, _addr("setupV3"), abi.encodeCall(FengceSetupV3.setup, (p)), FALLBACK, address(0), 0, payable(address(0))));
        vm.startBroadcast();
        address safe = FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256(abi.encode("fengce.m2b.fresh", block.timestamp))));
        require(IERC20M2b(LimitsLib.USDT0).transfer(safe, FUND), "fund");
        vm.stopBroadcast();
        (bool set,,,,,,) = _guard().configOf(safe);
        require(set && _guard().rulesOf(safe).partner == msg.sender, "guard v3 not set up");
        console.log("M2 freshSafe", safe);
        console.log("M2 funded", FUND);
    }

    function _catalog() internal {
        address safe = _addr("freshSafe");
        bytes32 pin;
        for (uint256 i; i < CATALOG.count(); i++) {
            Catalog.Entry memory e = CATALOG.entryAt(i);
            PinRegistry.CircuitPin memory c = REG.circuitPin(e.pinId);
            if (e.active && c.processor == LimitsLib.MAX_BUY_CPU && c.circuitId == 2) pin = e.pinId;
        }
        require(pin != bytes32(0), "Catalog listing for circuit #2 not found");
        (,,,, bytes32 netlistHash, bytes32 schemaHash) = REG.evalInfo(pin);
        Schema.Layout memory l;
        l.netlistHash = netlistHash;
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // over the cap
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1); // always 1
        require(Schema.hash(l) == schemaHash, "schema does not match the listing");
        TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, CAP);
        // Listings are free during launch: no payInstall. A paid listing is added at Safe creation (FengceSetupV3.setupWithCatalogFee).
        require(CATALOG.entryOf(pin).installFee == 0, "paid listing: add it at Safe creation");
        vm.startBroadcast();
        _changePolicy(safe, _input(pin, l, b));
        require(_send(safe, SMALL), "allowed send");
        vm.stopBroadcast();
        (, bytes32 now_,,,,,) = _guard().configOf(safe);
        require(now_ == pin, "policy not changed");
        console.log("M2 catalogPin", vm.toString(pin));
        console.log("M2 allowedSend", SMALL);
        uint8 code = _refuse(safe, LimitsLib.USDT0, abi.encodeCall(IERC20M2b.transfer, (msg.sender, OVER)), Enum.Operation.Call, FengceRulesV3.CIRCUIT);
        console.log("M2 refusedCode", code);
    }

    function _build() internal {
        address safe = _addr("freshSafe");
        ICircuitProcessor cpu = ICircuitProcessor(LimitsLib.COUNTER_CPU);
        ITransistors t = ITransistors(cpu.transistorsContract());
        Schema.Layout memory l;
        l.netlistHash = keccak256(OR_NETLIST);
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // a: amount over 0.1 USDT0
        l.fields[1] = Schema.Field(Schema.Kind.Bool, 1, 1, 0); // b: the token is USDC
        TxFacts.Binding[] memory b = new TxFacts.Binding[](2);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, CAP);
        b[1] = TxFacts.Binding(TxFacts.Source.TokenIs, uint256(uint160(USDC)));
        vm.startBroadcast();
        t.mint{value: t.protocolFee()}(t.NAND(), 4);
        uint256 id = cpu.tapeout{value: cpu.TAPEOUT_FEE()}(OR_NETLIST, 2, 1);
        bytes32 pin = REG.pin(LimitsLib.COUNTER_CPU, id, Schema.hash(l), bytes32(0));
        _changePolicy(safe, _input(pin, l, b));
        require(_send(safe, SMALL), "allowed send");
        vm.stopBroadcast();
        require(keccak256(cpu.netlist(id)) == keccak256(OR_NETLIST), "netlist on chain differs");
        console.log("M2 buildCircuitId", id);
        console.log("M2 buildPin", vm.toString(pin));
        console.log("M2 buildNetlistHash", vm.toString(keccak256(OR_NETLIST)));
        console.log("M2 allowedSend", SMALL);
        uint8 code = _refuse(safe, LimitsLib.USDT0, abi.encodeCall(IERC20M2b.transfer, (msg.sender, OVER)), Enum.Operation.Call, FengceRulesV3.CIRCUIT);
        console.log("M2 refusedCode", code);
    }

    function _hold() internal {
        address safe = _addr("safe");
        FengceGuardV3 g = _guard();
        FengceRulesV3.Rules memory r = g.rulesOf(safe);
        r.holdSeconds = 6 hours;
        uint256 before = IERC20M2b(LimitsLib.WOKB).balanceOf(safe);
        vm.startBroadcast();
        require(_exec(safe, address(g), abi.encodeCall(g.setRules, (r)), Enum.Operation.Call), "hold lock");
        require(_exec(safe, LimitsLib.MSCO, LimitsLib.swapMultiSend(safe, LimitsLib.USDT0, LimitsLib.WOKB, SMALL, 0), Enum.Operation.DelegateCall), "buy");
        vm.stopBroadcast();
        uint256 got = IERC20M2b(LimitsLib.WOKB).balanceOf(safe) - before;
        console.log("M2 holdSeconds", uint256(6 hours));
        console.log("M2 bought", SMALL);
        console.log("M2 boughtWokb", got);
        uint8 code = _refuse(safe, LimitsLib.MSCO, LimitsLib.swapMultiSend(safe, LimitsLib.WOKB, LimitsLib.USDT0, got, 0), Enum.Operation.DelegateCall, FengceRulesV3.HOLD_LOCK);
        console.log("M2 refusedCode", code);
    }

    function _quiet() internal {
        address safe = _addr("safe");
        FengceGuardV3 g = _guard();
        FengceRulesV3.Rules memory r = g.rulesOf(safe);
        uint8 h = uint8((block.timestamp / 1 hours) % 24);
        r.quietOn = true;
        r.quietStart = h;
        r.quietEnd = (h + 1) % 24;
        vm.startBroadcast();
        require(_exec(safe, address(g), abi.encodeCall(g.setRules, (r)), Enum.Operation.Call), "quiet hours");
        vm.stopBroadcast();
        console.log("M2 quietStart", uint256(h));
        console.log("M2 quietEnd", uint256(r.quietEnd));
        uint8 code = _refuse(safe, LimitsLib.MSCO, LimitsLib.swapMultiSend(safe, LimitsLib.USDT0, LimitsLib.WOKB, SMALL, 0), Enum.Operation.DelegateCall, FengceRulesV3.QUIET_HOURS);
        console.log("M2 refusedCode", code);
    }

    /// Partner, phase 1: schedule setting the deployer as the demo Safe's partner. Adding a partner counts as
    /// loosening (a partner can approve changes early), so it waits the Safe's 1-day admin delay.
    function _partner() internal {
        address safe = _addr("safe");
        FengceGuardV3 g = _guard();
        FengceRulesV3.Rules memory r = g.rulesOf(safe);
        r.partner = msg.sender;
        bytes memory cfg = abi.encodeCall(g.setRules, (r));
        vm.startBroadcast();
        require(_exec(safe, address(g), abi.encodeCall(g.scheduleAdmin, (address(g), cfg)), Enum.Operation.Call), "schedule partner");
        vm.stopBroadcast();
        console.log("M2 partnerData", vm.toString(cfg));
        console.log("M2 partnerReadyAt", g.adminReadyAt(g.adminId(safe, address(g), cfg)));
    }

    /// Partner, phase 2 (after the wait): apply the partner; schedule a small loosening (hold lock 6 h -> 3 h, which
    /// would wait 7 days with a partner), the partner approves it, and it applies at once.
    function _partner2() internal {
        address safe = _addr("safe");
        FengceGuardV3 g = _guard();
        bytes memory cfg = vm.parseJsonBytes(_state(), ".steps.partner.partnerData");
        vm.startBroadcast();
        require(_exec(safe, address(g), cfg, Enum.Operation.Call), "apply partner");
        vm.stopBroadcast();
        FengceRulesV3.Rules memory r = g.rulesOf(safe);
        require(r.partner == msg.sender, "partner not set");
        r.holdSeconds = 3 hours;
        bytes memory loosen = abi.encodeCall(g.setRules, (r));
        bytes32 id = g.adminId(safe, address(g), loosen);
        vm.startBroadcast();
        require(_exec(safe, address(g), abi.encodeCall(g.scheduleAdmin, (address(g), loosen)), Enum.Operation.Call), "schedule loosening");
        vm.stopBroadcast();
        uint256 waitWas = g.adminReadyAt(id);
        vm.startBroadcast();
        g.partnerApprove(safe, id);
        require(_exec(safe, address(g), loosen, Enum.Operation.Call), "apply early");
        vm.stopBroadcast();
        require(g.rulesOf(safe).holdSeconds == 3 hours, "not applied");
        console.log("M2 partner", msg.sender);
        console.log("M2 loosenReadyAtBeforeApproval", waitWas);
        console.log("M2 holdSecondsNow", uint256(3 hours));
    }
}

