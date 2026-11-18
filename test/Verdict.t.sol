// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {PinRegistry} from "../src/core/PinRegistry.sol";
import {Schema} from "../src/core/Schema.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {VerdictTypes} from "../src/verdict/VerdictTypes.sol";
import {Market, IERC20Min} from "../src/verdict/Market.sol";
import {MarketFactory} from "../src/verdict/MarketFactory.sol";

interface IERC20Full is IERC20Min {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// Fork tests on live X Layer. Native market: "TapeOut factory cpuCount() >= threshold at T", real
/// USDT0 collateral. Rule: a deployed 16-bit comparator circuit (a >= b, 114 gates; see
/// docs/ADDRESSES.md), a = observed value (inputs 0..15), b = committed threshold (inputs 16..31).
contract VerdictForkTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant CMP_CPU = 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F;
    uint256 constant CMP_ID = 7;
    IERC20Full constant USDT0 = IERC20Full(0x779Ded0c9e1022225f8E0630b35a9b54bE713736);

    PinRegistry reg;
    MarketFactory factory;
    bytes32 rulePin;
    bytes32 sourcePin;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = makeAddr("treasury");
    address reserveAddr = makeAddr("reserve");
    uint256 liveCount;

    function setUp() public {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        rulePin = reg.pin(CMP_CPU, CMP_ID, Schema.hash(_layout()), bytes32(0));
        // The factory proxy exposes no implementation getter, so it is pinned by code hash only.
        sourcePin = reg.pinContract(address(TAPEOUT), bytes4(0));
        factory = new MarketFactory(reg, USDT0, 2_000_000, 100, treasury, reserveAddr, 1 days, 30 days);
        liveCount = TAPEOUT.cpuCount();
        deal(address(USDT0), alice, 1_000e6);
        deal(address(USDT0), bob, 1_000e6);
    }

    function _layout() internal view returns (Schema.Layout memory l) {
        l.netlistHash = keccak256(ITapeOutProcessor(CMP_CPU).netlist(CMP_ID));
        l.nIn = 32;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 16, 0); // a: observed
        l.fields[1] = Schema.Field(Schema.Kind.Uint, 16, 16, 0); // b: threshold
    }

    function _market(uint256 threshold) internal returns (Market) {
        VerdictTypes.MarketSpec memory s;
        s.pinId = rulePin;
        s.layout = _layout();
        s.bindings = new VerdictTypes.Binding[](2);
        s.bindings[0] = VerdictTypes.Binding(VerdictTypes.Source.Observed, 0);
        s.bindings[1] = VerdictTypes.Binding(VerdictTypes.Source.Param, threshold);
        s.plan = VerdictTypes.DataPlan(
            address(TAPEOUT), abi.encodeWithSignature("cpuCount()"), sourcePin, "TapeOut cpuCount() >= threshold at T"
        );
        s.cutoff = uint64(block.timestamp + 1 hours);
        s.observationTime = uint64(block.timestamp + 1 hours);
        return Market(factory.createMarket(s));
    }

    function _bet(Market m, address who, Market.Side side, uint256 amount) internal {
        vm.startPrank(who);
        USDT0.approve(address(m), amount);
        m.bet(side, amount);
        vm.stopPrank();
    }

    function test_twoSidedMarketSettlesToCircuitOutcome() public {
        Market m = _market(liveCount - 10); // live count is above the threshold -> circuit says YES
        _bet(m, alice, Market.Side.Yes, 100e6);
        _bet(m, bob, Market.Side.No, 50e6);
        vm.warp(m.observationTime());
        m.settle();

        assertEq(uint256(m.state()), uint256(Market.State.Yes));
        assertEq(m.observed(), liveCount);
        (, bytes memory out) = m.evaluateRule(liveCount); // anyone can re-run the rule
        assertEq(out, hex"01");
        assertEq(USDT0.balanceOf(treasury), 1.5e6); // 1% of the 150 pool

        vm.prank(alice);
        m.claim();
        assertEq(USDT0.balanceOf(alice), 1_000e6 - 100e6 + 148.5e6);
        vm.prank(bob);
        vm.expectRevert(Market.MarketNothingToClaim.selector);
        m.claim();

        // Same rule, threshold above the live count -> NO.
        Market m2 = _market(liveCount + 1000);
        _bet(m2, alice, Market.Side.Yes, 10e6);
        _bet(m2, bob, Market.Side.No, 10e6);
        vm.warp(m2.observationTime());
        m2.settle();
        assertEq(uint256(m2.state()), uint256(Market.State.No));
    }

    function test_settleBeforeTReverts() public {
        Market m = _market(liveCount - 10);
        _bet(m, alice, Market.Side.Yes, 10e6);
        _bet(m, bob, Market.Side.No, 10e6);
        vm.warp(m.observationTime() - 1);
        vm.expectRevert(abi.encodeWithSelector(Market.MarketTooEarly.selector, m.observationTime()));
        m.settle();
    }

    function test_oneSidedPoolGoesInvalid() public {
        Market m = _market(liveCount - 10);
        _bet(m, alice, Market.Side.Yes, 100e6);
        vm.warp(m.observationTime());
        m.settle();

        assertEq(uint256(m.state()), uint256(Market.State.Invalid));
        assertEq(uint256(m.invalidReason()), uint256(Market.InvalidReason.OneSided));
        vm.prank(alice);
        m.claim();
        assertEq(USDT0.balanceOf(alice), 1_000e6); // full refund
        assertEq(USDT0.balanceOf(treasury), 0); // no fee on refunds
    }

    function test_brokenCircuitAtSettlementGoesInvalid() public {
        Market m = _market(liveCount - 10);
        _bet(m, alice, Market.Side.Yes, 100e6);
        _bet(m, bob, Market.Side.No, 50e6);
        vm.warp(m.observationTime());
        vm.mockCallRevert(CMP_CPU, abi.encodeWithSelector(ITapeOutProcessor.eval.selector), "dependency down");
        m.settle();

        assertEq(uint256(m.state()), uint256(Market.State.Invalid));
        assertEq(uint256(m.invalidReason()), uint256(Market.InvalidReason.RuleFailed));
        vm.prank(bob);
        m.claim();
        assertEq(USDT0.balanceOf(bob), 1_000e6);
    }

    function test_unpinnedCircuitAtSettlementGoesInvalid() public {
        Market m = _market(liveCount - 10);
        _bet(m, alice, Market.Side.Yes, 100e6);
        _bet(m, bob, Market.Side.No, 50e6);
        vm.warp(m.observationTime());
        // The factory deregisters the rule's processor: the pin no longer holds.
        vm.mockCall(address(TAPEOUT), abi.encodeWithSelector(ITapeOutFactory.isCPU.selector, CMP_CPU), abi.encode(false));
        assertFalse(reg.isPinned(rulePin));
        m.settle();

        assertEq(uint256(m.state()), uint256(Market.State.Invalid));
        assertEq(uint256(m.invalidReason()), uint256(Market.InvalidReason.RuleFailed));
    }
}
