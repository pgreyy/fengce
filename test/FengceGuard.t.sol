// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {PinRegistry} from "../src/core/PinRegistry.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";

interface IProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address);
}

/// Fork tests on live X Layer: a real Safe v1.5.0 from the official factory, guarded by Fengce with
/// the pinned one-NAND circuit. Policy: allow if amount <= 100 (circuit input a = amount > 100,
/// input b = 1, NAND(a, 1) = not a).
contract FengceGuardForkTest is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;
    uint256 constant NAND_ID = 2;
    IProxyFactory constant SAFE_FACTORY = IProxyFactory(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address constant MSCO = 0xA83c336B20401Af773B6219BA5027174338D1836;
    address immutable RECIP = makeAddr("recipient");
    uint64 constant DELAY = 1 days;

    ISafe safe;
    FengceGuard guard;

    function setUp() public {
        vm.createSelectFork("xlayer");
        PinRegistry reg = new PinRegistry(TAPEOUT);
        guard = new FengceGuard(reg, 2_000_000);

        Schema.Layout memory l;
        l.netlistHash = keccak256(ITapeOutProcessor(NAND_CPU).netlist(NAND_ID));
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // a: amount > 100
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1); // b: fixed 1
        bytes32 pinId = reg.pin(NAND_CPU, NAND_ID, Schema.hash(l), bytes32(0));

        address[] memory owners = new address[](1);
        owners[0] = address(this);
        bytes memory init = abi.encodeCall(
            ISafe.setup, (owners, 1, address(0), "", FALLBACK, address(0), 0, payable(address(0)))
        );
        safe = ISafe(payable(SAFE_FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256("fengce-test")))));
        vm.deal(address(safe), 1000);

        TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
        FengceGuard.ConfigInput memory cfg = FengceGuard.ConfigInput(pinId, l, b, DELAY, DELAY);

        // Install: configure, enable this test as a module, then both guards (in this order, the
        // module guard is installed while the transaction guard is already active).
        _exec(address(guard), 0, abi.encodeCall(FengceGuard.configure, (cfg)));
        _exec(address(safe), 0, abi.encodeWithSignature("enableModule(address)", address(this)));
        _exec(address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
    }

    // ---------------------------------------------------------------- helpers

    function _sig() internal view returns (bytes memory) {
        // Pre-validated signature: v = 1, r = owner, valid because the owner is msg.sender.
        return abi.encodePacked(uint256(uint160(address(this))), uint256(0), uint8(1));
    }

    function _execOp(address to, uint256 value, bytes memory data, Enum.Operation op) internal returns (bool) {
        return safe.execTransaction(to, value, data, op, 0, 0, 0, address(0), payable(address(0)), _sig());
    }

    function _exec(address to, uint256 value, bytes memory data) internal returns (bool) {
        return _execOp(to, value, data, Enum.Operation.Call);
    }

    function _multiSend(bytes memory packed) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("multiSend(bytes)", packed);
    }

    // ---------------------------------------------------------------- tests

    function test_ownerSend50Passes() public {
        assertTrue(_exec(RECIP, 50, ""));
        assertEq(RECIP.balance, 50);
    }

    function test_ownerSend150Blocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        _exec(RECIP, 150, "");
    }

    function test_moduleSend150Blocked() public {
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        safe.execTransactionFromModule(RECIP, 150, "", Enum.Operation.Call);
    }

    function test_multiSendHiding150Blocked_40plus40Passes() public {
        bytes memory hidden = abi.encodePacked(uint8(0), RECIP, uint256(150), uint256(0));
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), RECIP));
        _execOp(MSCO, 0, _multiSend(hidden), Enum.Operation.DelegateCall);

        bytes memory ok = abi.encodePacked(
            abi.encodePacked(uint8(0), RECIP, uint256(40), uint256(0)),
            abi.encodePacked(uint8(0), RECIP, uint256(40), uint256(0))
        );
        assertTrue(_execOp(MSCO, 0, _multiSend(ok), Enum.Operation.DelegateCall));
        assertEq(RECIP.balance, 80);
    }

    function test_guardRemovalWithoutScheduleBlocked() public {
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0)));
    }

    function test_recoveryWorksWhenCircuitReverts() public {
        // Break the dependency: the pinned processor now reverts on eval (code hash unchanged).
        vm.mockCallRevert(NAND_CPU, abi.encodeWithSelector(ITapeOutProcessor.eval.selector), "dependency down");

        vm.expectRevert(abi.encodeWithSelector(PolicyEngine.EngineEvalFailed.selector, guard.configOf(address(safe)).pinId));
        _exec(RECIP, 50, "");

        // Recovery never touches the circuit: schedule, wait, remove both guards.
        assertTrue(_exec(address(guard), 0, abi.encodeCall(guard.scheduleRecovery, ())));
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.RecoveryNotReady.selector, address(safe)));
        _exec(address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0)));

        vm.warp(block.timestamp + DELAY);
        assertTrue(_exec(address(safe), 0, abi.encodeWithSignature("setModuleGuard(address)", address(0))));
        assertTrue(_exec(address(safe), 0, abi.encodeWithSignature("setGuard(address)", address(0))));

        assertTrue(_exec(RECIP, 150, ""));
        assertEq(RECIP.balance, 150);
    }
}
