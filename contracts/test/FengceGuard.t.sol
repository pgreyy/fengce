// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Stand-in for the Bybit attack contract: when delegatecalled, it overwrites storage slot 0 (the Safe singleton).
contract SlotZeroWriter {
    address internal slot0;

    function transfer(address to, uint256) external {
        slot0 = to;
    }
}

/// Batch A fork tests: policy on owner, module and MultiSend paths; guard removal and recovery.
contract FengceGuardForkTest is ForkBase {
    ISafe safe;

    function setUp() public {
        _forkAndPin();
        safe = _newSafe();
        _install(safe);
    }

    function _multiSend(bytes memory packed) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("multiSend(bytes)", packed);
    }

    function test_ownerSend50Passes() public {
        assertTrue(_exec(safe, RECIP, 50, ""));
        assertEq(RECIP.balance, 50);
    }

    function test_ownerSend150Blocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        _exec(safe, RECIP, 150, "");
    }

    function test_moduleSend150Blocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        safe.execTransactionFromModule(RECIP, 150, "", Enum.Operation.Call);
    }

    function test_multiSendHiding150Blocked_40plus40Passes() public {
        bytes memory hidden = abi.encodePacked(uint8(0), RECIP, uint256(150), uint256(0));
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        _execOp(safe, MSCO, 0, _multiSend(hidden), Enum.Operation.DelegateCall);

        bytes memory ok = abi.encodePacked(
            abi.encodePacked(uint8(0), RECIP, uint256(40), uint256(0)),
            abi.encodePacked(uint8(0), RECIP, uint256(40), uint256(0))
        );
        assertTrue(_execOp(safe, MSCO, 0, _multiSend(ok), Enum.Operation.DelegateCall));
        assertEq(RECIP.balance, 80);
    }

    /// Bybit pattern: owners sign a delegatecall to a contract that replaces the Safe singleton. The guard refuses
    /// every delegatecall except MultiSendCallOnly, so the singleton stays as it was.
    function test_ownerDelegatecallUpgradeBlocked() public {
        SlotZeroWriter attacker = new SlotZeroWriter();
        bytes32 before = vm.load(address(safe), bytes32(0));
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", address(0xBAD), 0);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDelegateCallDenied.selector, address(attacker)));
        _execOp(safe, address(attacker), 0, data, Enum.Operation.DelegateCall);
        assertEq(vm.load(address(safe), bytes32(0)), before);
    }

    function test_guardRemovalWithoutScheduleBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0)));
    }

    function test_recoveryWorksWhenCircuitReverts() public {
        // Break the dependency: the pinned processor now reverts on eval (code hash unchanged).
        vm.mockCallRevert(NAND_CPU, abi.encodeWithSelector(ITapeOutProcessor.eval.selector), "dependency down");

        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineEvalFailed.selector, pinId));
        _exec(safe, RECIP, 50, "");

        // Recovery never touches the circuit: schedule, wait, remove both guards.
        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(guard.scheduleRecovery, ())));
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0)));

        vm.warp(block.timestamp + RECOVERY_DELAY);
        assertTrue(_exec(safe, address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(0))));
        assertTrue(_exec(safe, address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0))));

        assertTrue(_exec(safe, RECIP, 150, ""));
        assertEq(RECIP.balance, 150);
    }
}
