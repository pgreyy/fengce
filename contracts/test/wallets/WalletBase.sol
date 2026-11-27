// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {TxFacts} from "../../src/core/TxFacts.sol";
import {ForkBase} from "../utils/ForkBase.sol";

/// ERC-4337 v0.7 user operation.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPointV07 {
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32);
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

/// ERC-7579 execution entry points.
interface IERC7579Account {
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory);
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external payable;
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external payable;
}

/// Shared setup for the wallet fork tests: the X Layer fork with the pinned one-NAND policy
/// (allow if amount <= 100), helpers to copy account code that is not deployed on X Layer from a Base
/// fork, and a real EntryPoint v0.7 user operation path.
abstract contract WalletBase is ForkBase {
    IEntryPointV07 constant EP07 = IEntryPointV07(0x0000000071727De22E5E9d8BAf0edAc6f37da032); // live on X Layer
    bytes32 constant USEROP_EVENT =
        keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");
    bytes32 constant SINGLE = bytes32(0);
    bytes32 constant BATCH = bytes32(bytes1(0x01));

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    /// Reads runtime code of `addrs` on a Base fork, then selects a fresh X Layer fork, pins the policy and
    /// places that code at the same addresses. Nothing from these accounts is stored in this repository.
    function _forkWithBaseCode(address[] memory addrs) internal {
        vm.createSelectFork("base");
        bytes[] memory codes = new bytes[](addrs.length);
        for (uint256 i; i < addrs.length; i++) {
            codes[i] = addrs[i].code;
            require(codes[i].length > 0, "code not found on Base");
        }
        _forkAndPin();
        for (uint256 i; i < addrs.length; i++) {
            require(addrs[i].code.length == 0, "already on X Layer: test it there");
            vm.etch(addrs[i], codes[i]);
        }
    }

    function _bindings() internal pure returns (TxFacts.Binding[] memory b) {
        b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 100);
    }

    /// abi.encode(pinId, layout, bindings): the install data of FengceHook and FengceHook6900.
    function _hookCfg() internal view returns (bytes memory) {
        return abi.encode(pinId, _layout(), _bindings());
    }

    function _single(address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(to, value, data);
    }

    /// A batch of two plain transfers to RECIP: `a` then `b`.
    function _batch2(uint256 a, uint256 b) internal view returns (bytes memory) {
        Execution[] memory xs = new Execution[](2);
        xs[0] = Execution(RECIP, a, "");
        xs[1] = Execution(RECIP, b, "");
        return abi.encode(xs);
    }

    // ---------------------------------------------------------------- user operations

    /// Builds, signs (raw ECDSA over the EntryPoint's userOpHash) and submits one user operation through
    /// the real EntryPoint v0.7. Returns the `success` flag of UserOperationEvent (false = the account's
    /// execution reverted; the EntryPoint does not revert in that case).
    function _handleOp(address account, uint192 nonceKey, bytes memory callData, uint256 signerKey)
        internal
        returns (bool success)
    {
        PackedUserOperation memory op;
        op.sender = account;
        op.nonce = EP07.getNonce(account, nonceKey);
        op.callData = callData;
        op.accountGasLimits = bytes32((uint256(2_000_000) << 128) | uint256(5_000_000));
        op.preVerificationGas = 100_000;
        bytes32 h = EP07.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, h);
        op.signature = abi.encodePacked(r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        address bundler = makeAddr("bundler");
        vm.recordLogs();
        vm.prank(bundler, bundler);
        EP07.handleOps(ops, payable(bundler));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(EP07) && logs[i].topics[0] == USEROP_EVENT) {
                (, success,,) = abi.decode(logs[i].data, (uint256, bool, uint256, uint256));
                return success;
            }
        }
        revert("no UserOperationEvent");
    }
}
