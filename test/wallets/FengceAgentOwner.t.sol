// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceAgentOwner, IOwnerExecute} from "../../src/agent/FengceAgentOwner.sol";
import {WalletBase} from "./WalletBase.sol";

interface ICoinbaseFactory {
    function createAccount(bytes[] calldata owners, uint256 nonce) external payable returns (address);
}

interface ICoinbaseWallet {
    function addOwnerAddress(address owner) external;
    function isOwnerAddress(address account) external view returns (bool);
}

/// Coinbase Smart Wallet has no hook or module system. FengceAgentOwner is added as one of its owners and gives
/// agent keys a path that the circuit checks. Not deployed on X Layer: the canonical factory (v1.1) and
/// implementation code is read from Base and placed at the same addresses on the X Layer fork.
contract FengceAgentOwnerForkTest is WalletBase {
    address constant FACTORY = 0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842;
    address constant IMPL = 0x00000110dCdEdC9581cb5eCB8467282f2926534d;

    FengceAgentOwner gate;
    address wallet;
    address agent;

    function setUp() public {
        address[] memory addrs = new address[](2);
        (addrs[0], addrs[1]) = (FACTORY, IMPL);
        _forkWithBaseCode(addrs);
        gate = new FengceAgentOwner(reg, 2_000_000);
        agent = makeAddr("agent");
        bytes[] memory owners = new bytes[](1);
        owners[0] = abi.encode(address(this));
        wallet = ICoinbaseFactory(FACTORY).createAccount(owners, 0);
        vm.deal(wallet, 1000);

        // The owner (this test) sets it up from the wallet: add the gate as an owner, set the policy, add the agent.
        ICoinbaseWallet(wallet).addOwnerAddress(address(gate));
        IOwnerExecute(wallet)
            .execute(address(gate), 0, abi.encodeCall(FengceAgentOwner.configure, (pinId, _layout(), _bindings())));
        IOwnerExecute(wallet).execute(address(gate), 0, abi.encodeCall(FengceAgentOwner.addAgent, (agent, 0)));
        assertTrue(ICoinbaseWallet(wallet).isOwnerAddress(address(gate)));
        assertTrue(gate.isConfigured(wallet));
    }

    function test_coinbaseAgentThroughCircuit() public {
        vm.prank(agent);
        gate.execute(wallet, RECIP, 50, "");
        assertEq(RECIP.balance, 50);

        // Over the limit: refused, recorded as Denied, nothing executed.
        vm.expectEmit(true, true, false, false, address(gate));
        emit FengceAgentOwner.Denied(wallet, agent, RECIP, bytes32(0), "");
        vm.prank(agent);
        gate.execute(wallet, RECIP, 150, "");
        assertEq(RECIP.balance, 50);

        // Agents cannot call the wallet itself (for example to add themselves as owners).
        vm.expectEmit(true, true, false, false, address(gate));
        emit FengceAgentOwner.Denied(wallet, agent, wallet, bytes32(0), "");
        vm.prank(agent);
        gate.execute(wallet, wallet, 0, abi.encodeCall(ICoinbaseWallet.addOwnerAddress, (agent)));
        assertFalse(ICoinbaseWallet(wallet).isOwnerAddress(agent));

        // Unknown keys are refused.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        gate.execute(wallet, RECIP, 1, "");

        // The wallet's own owner is not checked (no hook exists): documented limit.
        IOwnerExecute(wallet).execute(RECIP, 150, "");
        assertEq(RECIP.balance, 200);
    }
}
