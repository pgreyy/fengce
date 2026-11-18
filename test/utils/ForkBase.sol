// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {PinRegistry} from "../../src/core/PinRegistry.sol";
import {Schema} from "../../src/core/Schema.sol";
import {TxFacts} from "../../src/core/TxFacts.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../../src/safe/FengceGuard.sol";

interface IProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address);
}

/// Shared setup for fork tests on live X Layer: the pinned one-NAND circuit, real Safe v1.5.0
/// proxies from the official factory, and helpers to sign and execute Safe transactions.
/// Policy used throughout: allow if amount <= 100 (input a = amount > 100, input b = 1).
abstract contract ForkBase is Test {
    ITapeOutFactory constant TAPEOUT = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;
    uint256 constant NAND_ID = 2;
    IProxyFactory constant SAFE_FACTORY = IProxyFactory(0x14F2982D601c9458F93bd70B218933A6f8165e7b);
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address constant MSCO = 0xA83c336B20401Af773B6219BA5027174338D1836;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    bytes32 constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    uint64 constant DELAY = 1 days;
    uint64 constant WINDOW = 2 days;

    address immutable RECIP = makeAddr("recipient");
    uint256 constant OWNER2_KEY = 0xB0B;

    PinRegistry reg;
    FengceGuard guard;
    bytes32 pinId;
    uint256 salt;

    function _forkAndPin() internal {
        vm.createSelectFork("xlayer");
        reg = new PinRegistry(TAPEOUT);
        guard = new FengceGuard(reg, 2_000_000);
        pinId = reg.pin(NAND_CPU, NAND_ID, Schema.hash(_layout()), bytes32(0));
    }

    function _layout() internal view returns (Schema.Layout memory l) {
        l.netlistHash = keccak256(ITapeOutProcessor(NAND_CPU).netlist(NAND_ID));
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // a: amount > 100
        l.fields[1] = Schema.Field(Schema.Kind.Flag, 1, 1, 1); // b: fixed 1
    }

    function _cfg() internal view returns (FengceGuard.ConfigInput memory c) {
        TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
        c.pinId = pinId;
        c.layout = _layout();
        c.bindings = b;
        c.recoveryDelay = DELAY;
        c.recoveryWindow = WINDOW;
        c.adminDelay = DELAY;
    }

    /// One owner: this contract.
    function _newSafe() internal returns (ISafe) {
        address[] memory owners = new address[](1);
        owners[0] = address(this);
        return _newSafe(owners, 1);
    }

    /// Two owners (this contract and OWNER2_KEY's address), threshold 1.
    function _newSafe2() internal returns (ISafe) {
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = vm.addr(OWNER2_KEY);
        return _newSafe(owners, 1);
    }

    function _newSafe(address[] memory owners, uint256 threshold) internal returns (ISafe s) {
        bytes memory init = abi.encodeCall(
            ISafe.setup, (owners, threshold, address(0), "", FALLBACK, address(0), 0, payable(address(0)))
        );
        s = ISafe(payable(SAFE_FACTORY.createProxyWithNonce(SAFE_L2, init, uint256(keccak256(abi.encode("fengce", salt++))))));
        vm.deal(address(s), 1000);
    }

    /// Configure, enable this test as a module, then install both guards.
    function _install(ISafe s) internal {
        _exec(s, address(guard), 0, abi.encodeCall(FengceGuard.configure, (_cfg())));
        _exec(s, address(s), 0, abi.encodeWithSignature("enableModule(address)", address(this)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(s, address(s), 0, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
    }

    // ---------------------------------------------------------------- signing and execution

    /// Pre-validated signature for this contract: v = 1, r = owner (valid because it is msg.sender).
    function _sigThis() internal view returns (bytes memory) {
        return abi.encodePacked(uint256(uint160(address(this))), uint256(0), uint8(1));
    }

    /// Signatures from this contract and OWNER2 on a plain call with value 0, sorted by owner
    /// address as Safe requires.
    function _sigBoth(ISafe s, address to, bytes memory data) internal view returns (bytes memory) {
        uint256 n = s.nonce();
        bytes32 h = s.getTransactionHash(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), address(0), n);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(OWNER2_KEY, h);
        bytes memory sig2 = abi.encodePacked(r, ss, v);
        return address(this) < vm.addr(OWNER2_KEY)
            ? abi.encodePacked(_sigThis(), sig2)
            : abi.encodePacked(sig2, _sigThis());
    }

    function _execSigned(ISafe s, address to, uint256 value, bytes memory data, Enum.Operation op, bytes memory sigs)
        internal
        returns (bool)
    {
        return s.execTransaction(to, value, data, op, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    function _execOp(ISafe s, address to, uint256 value, bytes memory data, Enum.Operation op) internal returns (bool) {
        return _execSigned(s, to, value, data, op, _sigThis());
    }

    function _exec(ISafe s, address to, uint256 value, bytes memory data) internal returns (bool) {
        return _execOp(s, to, value, data, Enum.Operation.Call);
    }
}
