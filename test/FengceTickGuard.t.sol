// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {Schema} from "../src/core/Schema.sol";
import {Tick} from "../src/core/Tick.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {AgentExecutor} from "../src/safe/AgentExecutor.sol";
import {ForkBase} from "./utils/ForkBase.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}

/// Fork tests on live X Layer: Tick wired into FengceGuard. Stateless policy: amount <= 100 (NAND).
/// Stateful policy: one spend per hour per group (toggle circuit 0xE2a6…1cd7 #18), shared by a group.
contract FengceTickGuardForkTest is ForkBase {
    address constant TOGGLE_CPU = 0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7;
    uint64 constant PERIOD = 1 hours;

    Tick tick;
    bytes32 group;
    AgentExecutor exec;
    address agent = makeAddr("agent");

    function setUp() public {
        _forkAndPin();
        tick = new Tick(reg, 1_000_000);
        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(TOGGLE_CPU).netlist(18));
        l.nIn = 1;
        l.fields = new Schema.Field[](1);
        l.fields[0] = Schema.Field(Schema.Kind.Flag, 0, 1, 1); // every checked call is one spend
        bytes32 togglePin = reg.pin(TOGGLE_CPU, 18, Schema.hash(l), bytes32(0));
        vm.warp((block.timestamp / PERIOD + 1) * PERIOD);
        group = tick.createGroup(bytes32("team budget"), togglePin, PERIOD, l, new TxFacts.Binding[](0));
        exec = new AgentExecutor(address(guard));
    }

    /// A Safe in the shared group, with Fengce + Tick installed (and optionally the agent executor).
    function _member(bool withAgent) internal returns (ISafe s) {
        s = _newSafe();
        tick.setMember(group, address(s), true);
        _exec(s, address(tick), 0, abi.encodeCall(Tick.setRelayer, (address(guard), true)));
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configureTick, (address(tick), group)));
        if (withAgent) {
            _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(exec), AgentExecutor.addAgent.selector, true)));
        }
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (_cfg())));
        _exec(s, address(s), 0, abi.encodeWithSignature("enableModule(address)", address(this)));
        if (withAgent) _exec(s, address(s), 0, abi.encodeWithSignature("enableModule(address)", address(exec)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
        vm.warp((block.timestamp / PERIOD + 1) * PERIOD); // fresh period for the test body
    }

    function _nonce() internal view returns (uint64 n) {
        (,,,, n,) = tick.groupOf(group);
    }

    function test_agentCannotSkipTick() public {
        ISafe s = _member(true);
        _exec(s, address(exec), 0, abi.encodeCall(AgentExecutor.addAgent, (agent, 0))); // counts as this period's spend
        vm.warp(block.timestamp + PERIOD);

        vm.prank(agent);
        exec.execute(address(s), RECIP, 50, "");
        assertEq(RECIP.balance, 50);
        // Within the circuit's amount limit, but the group's one spend this period is used.
        vm.expectEmit(address(exec));
        emit AgentExecutor.Denied(
            address(s), agent, RECIP, keccak256(abi.encode(RECIP, uint256(50), keccak256(""))),
            abi.encodeWithSelector(Tick.TickDenied.selector, group, address(s))
        );
        vm.prank(agent);
        exec.execute(address(s), RECIP, 50, "");
        // The owner path is capped by the same state.
        vm.expectRevert(abi.encodeWithSelector(Tick.TickDenied.selector, group, address(s)));
        _exec(s, RECIP, 10, "");
        assertEq(RECIP.balance, 50);
    }

    function test_twoSafesInOneGroupShareOneCap() public {
        ISafe a = _member(false);
        ISafe b = _member(false);
        assertTrue(_exec(a, RECIP, 50, ""));
        vm.expectRevert(abi.encodeWithSelector(Tick.TickDenied.selector, group, address(b)));
        _exec(b, RECIP, 50, "");

        vm.warp(block.timestamp + PERIOD); // next period
        assertTrue(_exec(b, RECIP, 50, ""));
        assertEq(RECIP.balance, 100);
    }

    function test_tickRollsBackWhenSafeExecutionFails() public {
        ISafe s = _member(false);
        uint64 before = _nonce();
        address bad = address(new RevertingReceiver());
        // Module transaction whose call fails: the Safe reports failure instead of reverting.
        assertFalse(s.execTransactionFromModule(bad, 1, "", Enum.Operation.Call));
        assertEq(_nonce(), before); // rolled back
        assertTrue(_exec(s, RECIP, 50, "")); // the period's spend is still available
        assertEq(_nonce(), before + 1);
    }
}
