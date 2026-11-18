// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";
import {ITransactionGuard} from "@safe/base/GuardManager.sol";
import {IERC165} from "@safe/interfaces/IERC165.sol";

import {TxFacts} from "../src/core/TxFacts.sol";
import {ApprovalScan} from "../src/core/ApprovalScan.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// A guard that allows everything: what a hostile or careless owner would swap in.
contract NoopGuard is ITransactionGuard {
    function checkTransaction(
        address,
        uint256,
        bytes memory,
        Enum.Operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external override {}

    function checkAfterExecution(bytes32, bool) external override {}

    function supportsInterface(bytes4 id) external pure override returns (bool) {
        return id == type(ITransactionGuard).interfaceId || id == type(IERC165).interfaceId;
    }
}

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// Batch B fork tests on live X Layer.
contract FengceBatchBForkTest is ForkBase {
    function setUp() public {
        _forkAndPin();
    }

    function _setGuard(address g) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("setGuard(address)", g);
    }

    function test_guardSwapNeedsRecovery() public {
        ISafe safe = _newSafe();
        _install(safe);
        address other = address(new NoopGuard());

        // Not directly, and not through the normal timelock.
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(safe, address(safe), 0, _setGuard(other));
        vm.expectRevert(
            abi.encodeWithSelector(SafeAdmin.AdminNotAllowed.selector, address(safe), bytes4(keccak256("setGuard(address)")))
        );
        _exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(safe), _setGuard(other))));

        // Recovery scheduled (all owners: this Safe has one), still blocked during the delay.
        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleRecovery, ())));
        vm.warp(block.timestamp + RECOVERY_DELAY - 1);
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(safe, address(safe), 0, _setGuard(other));

        vm.warp(block.timestamp + 1);
        assertTrue(_exec(safe, address(safe), 0, _setGuard(other)));
        assertEq(address(uint160(uint256(vm.load(address(safe), GUARD_SLOT)))), other);
    }

    function test_expiredRecoveryCannotExecute() public {
        ISafe safe = _newSafe();
        _install(safe);
        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleRecovery, ())));

        vm.warp(block.timestamp + RECOVERY_DELAY + WINDOW);
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryExpired.selector, address(safe)));
        _exec(safe, address(safe), 0, _setGuard(address(0)));
    }

    function test_twoOwnerSafe_oneSignatureCannotScheduleRecovery() public {
        ISafe safe = _newSafe2(); // threshold 1: one signature is a valid Safe transaction
        _install(safe);
        bytes memory data = abi.encodeCall(SafeAdmin.scheduleRecovery, ());

        vm.expectRevert(FengceGuard.FengceNotAllOwners.selector);
        _exec(safe, address(guard), 0, data);
        assertEq(guard.recoveryReadyAt(address(safe)), 0);

        // Both owners sign: accepted.
        bytes memory both = _sigBoth(safe, address(guard), data);
        assertTrue(_execSigned(safe, address(guard), 0, data, Enum.Operation.Call, both));
        assertEq(guard.recoveryReadyAt(address(safe)), block.timestamp + RECOVERY_DELAY);
    }

    function test_timelockChangeThreshold() public {
        ISafe safe = _newSafe2();
        _install(safe);
        bytes memory change = abi.encodeWithSignature("changeThreshold(uint256)", 2);
        bytes32 id = guard.adminId(address(safe), address(safe), change);

        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, id));
        _exec(safe, address(safe), 0, change);

        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(safe), change))));
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, id));
        _exec(safe, address(safe), 0, change);

        vm.warp(block.timestamp + DELAY);
        assertTrue(_exec(safe, address(safe), 0, change));
        assertEq(safe.getThreshold(), 2);
        assertEq(guard.adminReadyAt(id), 0); // consumed
    }

    function test_setApprovalForAllBlocked() public {
        ISafe safe = _newSafe();
        _install(safe);
        address nft = makeAddr("nft");
        address operator = makeAddr("operator");

        vm.expectRevert(abi.encodeWithSelector(TxFacts.TxApprovalForAllDenied.selector, nft, operator));
        _exec(safe, nft, 0, abi.encodeWithSignature("setApprovalForAll(address,bool)", operator, true));
    }

    function test_preflightCatchesExistingAllowance() public {
        ISafe safe = _newSafe();
        address spender = makeAddr("spender");
        // Before Fengce: the Safe approves a spender on real USDT0.
        assertTrue(_exec(safe, USDT0, 0, abi.encodeCall(IERC20Approve.approve, (spender, 500))));

        address[] memory tokens = new address[](1);
        tokens[0] = USDT0;
        address[] memory spenders = new address[](1);
        spenders[0] = spender;
        ApprovalScan.Finding[] memory f = guard.preflight(address(safe), tokens, spenders);
        assertEq(f.length, 1);
        assertEq(uint256(f[0].kind), uint256(ApprovalScan.FindingKind.Erc20Allowance));
        assertEq(f[0].token, USDT0);
        assertEq(f[0].spender, spender);
        assertEq(f[0].amount, 500);

        FengceGuard.ConfigInput memory c = _cfg();
        c.preflightTokens = tokens;
        c.preflightSpenders = spenders;
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceExistingApprovals.selector, 1));
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c)));

        // Explicit override: configures and records the warning.
        c.acceptExistingApprovals = true;
        vm.expectEmit(address(guard));
        emit FengceGuard.ExistingApprovalAccepted(
            address(safe), ApprovalScan.FindingKind.Erc20Allowance, USDT0, spender, 500
        );
        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.configure, (c))));
        assertTrue(guard.configOf(address(safe)).set);
    }
}
