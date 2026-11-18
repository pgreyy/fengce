// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {ISafeSignatureVerifier} from "@safe/handler/extensible/SignatureVerifierMuxer.sol";

import {TxFacts} from "../core/TxFacts.sol";
import {FengceGuard} from "./FengceGuard.sol";

/// @title FengceSignatureVerifier
/// @notice Domain verifier for Safe's ExtensibleFallbackHandler (v1.5.0) and FengceStrictHandler.
/// Registered by a Safe for the Permit2 domain and for EIP-2612 token domains, it turns an off-chain
/// approval the owners signed into approval facts, runs them through the Safe's Fengce policy, and
/// only then checks the owners' signatures. Anything it does not recognise is rejected.
///
/// Signature format (built by the signer, passed to `isValidSignature` by the protocol):
///   0x5fd7e97d ++ abi.encode(domainSeparator, typeHash, encodeData, payload)
///   payload = abi.encode(bytes data, bytes ownerSignatures)
///   - Permit2 PermitSingle: data = abi.encode(PermitDetails)
///   - Permit2 PermitBatch:  data = abi.encode(PermitDetails[])
///   - EIP-2612 Permit:      data = abi.encode(address token)
/// ownerSignatures are Safe signatures (threshold) over the Safe message hash of the EIP-712 hash,
/// exactly as Safe's default isValidSignature expects them.
contract FengceSignatureVerifier is ISafeSignatureVerifier {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 public constant PERMIT_DETAILS_TYPEHASH =
        keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)");
    bytes32 public constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 public constant PERMIT_BATCH_TYPEHASH = keccak256(
        "PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 public constant EIP2612_PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    /// keccak256("SafeMessage(bytes message)")
    bytes32 internal constant SAFE_MSG_TYPEHASH = 0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca;
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    FengceGuard public immutable guard;

    error VerifierUnknownType(bytes32 domainSeparator, bytes32 typeHash);
    error VerifierBadData();
    error VerifierWrongOwner(address owner);
    error VerifierNoOwnerSignatures();

    constructor(FengceGuard guard_) {
        guard = guard_;
    }

    function isValidSafeSignature(
        ISafe safe,
        address,
        bytes32 _hash,
        bytes32 domainSeparator,
        bytes32 typeHash,
        bytes calldata encodeData,
        bytes calldata payload
    ) external view override returns (bytes4) {
        (bytes memory data, bytes memory ownerSigs) = abi.decode(payload, (bytes, bytes));

        if (domainSeparator == _permit2Domain() && typeHash == PERMIT_SINGLE_TYPEHASH) {
            _permitSingle(address(safe), encodeData, data);
        } else if (domainSeparator == _permit2Domain() && typeHash == PERMIT_BATCH_TYPEHASH) {
            _permitBatch(address(safe), encodeData, data);
        } else if (typeHash == EIP2612_PERMIT_TYPEHASH) {
            _permit2612(address(safe), domainSeparator, encodeData, data);
        } else {
            revert VerifierUnknownType(domainSeparator, typeHash);
        }

        // Policy passed; now the owners must have signed this exact EIP-712 hash.
        if (ownerSigs.length == 0) revert VerifierNoOwnerSignatures();
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                bytes1(0x19), bytes1(0x01), safe.domainSeparator(), keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(_hash))))
            )
        );
        safe.checkSignatures(address(0), messageHash, ownerSigs);
        return ERC1271_MAGIC;
    }

    /// encodeData = abi.encode(hash(details), spender, sigDeadline)
    function _permitSingle(address safe, bytes calldata encodeData, bytes memory data) private view {
        if (encodeData.length != 96) revert VerifierBadData();
        (bytes32 detailsHash, address spender,) = abi.decode(encodeData, (bytes32, address, uint256));
        PermitDetails memory d = abi.decode(data, (PermitDetails));
        if (_hashDetails(d) != detailsHash) revert VerifierBadData();
        _check(safe, spender, d.token, d.amount);
    }

    /// encodeData = abi.encode(keccak256(concat(hash(details[i]))), spender, sigDeadline)
    function _permitBatch(address safe, bytes calldata encodeData, bytes memory data) private view {
        if (encodeData.length != 96) revert VerifierBadData();
        (bytes32 listHash, address spender,) = abi.decode(encodeData, (bytes32, address, uint256));
        PermitDetails[] memory ds = abi.decode(data, (PermitDetails[]));
        bytes32[] memory hashes = new bytes32[](ds.length);
        for (uint256 i; i < ds.length; i++) {
            hashes[i] = _hashDetails(ds[i]);
        }
        if (keccak256(abi.encodePacked(hashes)) != listHash || ds.length == 0) revert VerifierBadData();
        for (uint256 i; i < ds.length; i++) {
            _check(safe, spender, ds[i].token, ds[i].amount);
        }
    }

    /// encodeData = abi.encode(owner, spender, value, nonce, deadline); the token is proven by its
    /// own DOMAIN_SEPARATOR() matching the signed domain.
    function _permit2612(address safe, bytes32 domainSeparator, bytes calldata encodeData, bytes memory data)
        private
        view
    {
        if (encodeData.length != 160 || data.length != 32) revert VerifierBadData();
        (address owner, address spender, uint256 value,,) =
            abi.decode(encodeData, (address, address, uint256, uint256, uint256));
        if (owner != safe) revert VerifierWrongOwner(owner);
        address token = abi.decode(data, (address));
        (bool ok, uint256 w) = TxFacts.staticWord(token, abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        if (!ok || bytes32(w) != domainSeparator) revert VerifierBadData();
        _check(safe, spender, token, value);
    }

    function _check(address safe, address spender, address token, uint256 amount) private view {
        guard.checkContext(safe, TxFacts.base(TxFacts.Kind.Approval, safe, spender, 0, token, amount, TxFacts.PERMIT2_APPROVE));
    }

    function _hashDetails(PermitDetails memory d) private pure returns (bytes32) {
        return keccak256(abi.encode(PERMIT_DETAILS_TYPEHASH, d.token, d.amount, d.expiration, d.nonce));
    }

    function _permit2Domain() private view returns (bytes32 d) {
        (bool ok, uint256 w) = TxFacts.staticWord(PERMIT2, abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        if (ok) d = bytes32(w);
    }
}
