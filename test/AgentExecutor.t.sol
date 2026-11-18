// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {AgentExecutor} from "../src/safe/AgentExecutor.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Fork test on live X Layer: an agent key acts for a Safe only through AgentExecutor, and every call
/// is checked by the Safe's Fengce module guard (allow if amount <= 100).
contract AgentExecutorForkTest is ForkBase {
    ISafe safe;
    AgentExecutor exec;
    address agent = makeAddr("agent");

    function setUp() public {
        _forkAndPin();
        exec = new AgentExecutor(address(guard));
        safe = _newSafe();
        // Allowlist addAgent before the first configuration (afterwards: timelock).
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(exec), AgentExecutor.addAgent.selector, true)));
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (_cfg())));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(exec)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
        assertTrue(_exec(safe, address(exec), 0, abi.encodeCall(AgentExecutor.addAgent, (agent, 0))));
    }

    function test_agentGoesThroughCircuit_overLimitBlocked() public {
        vm.prank(agent);
        exec.execute(address(safe), RECIP, 50, "");
        assertEq(RECIP.balance, 50);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        exec.execute(address(safe), RECIP, 150, "");
        assertEq(RECIP.balance, 50);
    }

    function test_ownerRevokesAgent() public {
        vm.expectEmit(address(exec));
        emit AgentExecutor.AgentRevoked(address(safe), agent, address(this));
        exec.revokeAgent(address(safe), agent); // this test contract is an owner
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentExecutor.AgentNotAuthorised.selector, address(safe), agent));
        exec.execute(address(safe), RECIP, 50, "");

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(abi.encodeWithSelector(AgentExecutor.AgentNotOwner.selector, makeAddr("stranger")));
        exec.revokeAgent(address(safe), agent);
    }

    function test_refusesWithoutFengceModuleGuard() public {
        ISafe bare = _newSafe();
        _exec(bare, address(bare), 0, abi.encodeWithSignature("enableModule(address)", address(exec)));
        vm.expectRevert(abi.encodeWithSelector(AgentExecutor.AgentGuardMissing.selector, address(bare)));
        _exec(bare, address(exec), 0, abi.encodeCall(AgentExecutor.addAgent, (agent, 0)));
    }
}
