// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {FengceInspector} from "../src/safe/FengceInspector.sol";
import {ForkBase} from "./utils/ForkBase.sol";

interface IERC20T {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// An undecoded contract that spends an allowance it was given earlier.
contract Drainer {
    function pull(address token, address from, address to, uint256 amount) external {
        IERC20T(token).transferFrom(from, to, amount);
    }
}

/// A module that changes the Safe's threshold during a call.
contract RogueModule {
    function poke(address safe) external {
        ISafe(payable(safe)).execTransactionFromModule(safe, 0, abi.encodeWithSignature("changeThreshold(uint256)", 2), Enum.Operation.Call);
    }
}

/// Fork tests on live X Layer: outcome facts. Policy = NOR (0x87BFCa…F9a6 #52) with
/// a = amount > 100 (before execution) and b = watched outflow > 100 (after execution).
contract FengceInspectorForkTest is ForkBase {
    address constant NOR_CPU = 0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6;

    FengceInspector inspector;
    Drainer drainer;
    bytes32 norPin;
    Schema.Layout norLayout;

    function setUp() public {
        _forkAndPin();
        address[] memory adapters = new address[](1);
        adapters[0] = address(guard);
        inspector = new FengceInspector(adapters);
        drainer = new Drainer();
        norLayout.netlistHash = keccak256(ITapeOutProcessor(NOR_CPU).netlist(52));
        norLayout.nIn = 2;
        norLayout.fields.push(Schema.Field(Schema.Kind.Bool, 0, 1, 0));
        norLayout.fields.push(Schema.Field(Schema.Kind.Bool, 1, 1, 0));
        norPin = reg.pin(NOR_CPU, 52, Schema.hash(norLayout), bytes32(0));
    }

    function _norCfg() internal view returns (FengceGuard.ConfigInput memory c) {
        c = _cfg();
        c.pinId = norPin;
        c.layout = norLayout;
        c.bindings = new TxFacts.Binding[](2);
        c.bindings[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
        c.bindings[1] = TxFacts.Binding(TxFacts.Source.OutflowGt, 100);
    }

    function _watchUsdt0(ISafe s) internal {
        address[] memory assets = new address[](1);
        assets[0] = USDT0;
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configureInspector, (address(inspector), abi.encode(assets, new address[](0)))));
    }

    function _drainSafe() internal returns (ISafe s) {
        s = _newSafe();
        deal(USDT0, address(s), 1_000);
        _exec(s, USDT0, 0, abi.encodeCall(IERC20T.approve, (address(drainer), 1_000))); // before Fengce
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(drainer), Drainer.pull.selector, true)));
        _watchUsdt0(s);
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (_norCfg())));
        _exec(s, address(s), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
    }

    function test_undecodedDrainPastCapDeniedAfterExecution() public {
        ISafe s = _drainSafe();
        bytes memory pull = abi.encodeCall(Drainer.pull, (USDT0, address(s), RECIP, 150));
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(s), address(0)));
        _exec(s, address(drainer), 0, pull);
        assertEq(IERC20T(USDT0).balanceOf(RECIP), 0);
        assertEq(IERC20T(USDT0).balanceOf(address(s)), 1_000);
    }

    function test_undecodedDrainWithinCapPasses() public {
        ISafe s = _drainSafe();
        assertTrue(_exec(s, address(drainer), 0, abi.encodeCall(Drainer.pull, (USDT0, address(s), RECIP, 50))));
        assertEq(IERC20T(USDT0).balanceOf(RECIP), 50);
    }

    function test_unexpectedThresholdChangeDenied() public {
        ISafe s = _newSafe2(); // two owners, threshold 1
        RogueModule rogue = new RogueModule();
        _exec(s, address(s), 0, abi.encodeWithSignature("enableModule(address)", address(rogue)));
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(rogue), RogueModule.poke.selector, true)));
        _watchUsdt0(s);
        FengceGuard.ConfigInput memory c = _norCfg();
        c.acceptExistingModules = true;
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));
        // Transaction guard only: without the module guard, the module's own call is not checked, so the
        // change happens during execution and only the outcome check sees it.
        _exec(s, address(s), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));

        vm.expectRevert(abi.encodeWithSelector(FengceInspector.InspectorConfigChanged.selector, address(s)));
        _exec(s, address(rogue), 0, abi.encodeCall(RogueModule.poke, (address(s))));
        assertEq(s.getThreshold(), 1);
    }
}
