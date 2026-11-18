// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {ERC165Handler} from "@safe/handler/extensible/ERC165Handler.sol";
import {IFallbackHandler, FallbackHandler} from "@safe/handler/extensible/FallbackHandler.sol";
import {
    ERC1271,
    ISafeSignatureVerifier,
    ISignatureVerifierMuxer
} from "@safe/handler/extensible/SignatureVerifierMuxer.sol";
import {ERC721TokenReceiver, ERC1155TokenReceiver, TokenCallbacks} from "@safe/handler/extensible/TokenCallbacks.sol";

/// @title FengceStrictHandler
/// @notice "Strict Signatures" fallback handler for Safe v1.5.0. It is Safe's ExtensibleFallbackHandler
/// (same fallback methods, token callbacks, ERC-165 and domain verifier settings, built from the same
/// Safe v1.5.0 components) with one difference: `isValidSignature` has **no default path**. A signature
/// is valid only if it targets a domain for which the Safe registered a verifier and that verifier
/// accepts it. Plain owner signatures and approved hashes are refused, so an off-chain signature
/// cannot move assets around the Fengce policy.
///
/// Trade-off: dApps that rely on plain off-chain Safe signatures (for example sign-in messages or
/// off-chain orders) stop working for this Safe; use on-chain approvals instead.
/// Install with Safe.setFallbackHandler; with FengceGuard installed, changing the fallback handler or a
/// domain verifier goes through the admin timelock.
contract FengceStrictHandler is FallbackHandler, TokenCallbacks, ERC165Handler, ERC1271, ISignatureVerifierMuxer {
    /// keccak256("safeSignature(bytes32,bytes32,bytes,bytes)")
    bytes4 private constant SAFE_SIGNATURE_MAGIC_VALUE = 0x5fd7e97d;

    mapping(ISafe => mapping(bytes32 => ISafeSignatureVerifier)) public override domainVerifiers;

    /// @notice A Safe changed which verifier checks signatures for a domain.
    /// @param safe The Safe
    /// @param domainSeparator EIP-712 domain separator
    /// @param oldVerifier Previous verifier (zero if none)
    /// @param newVerifier New verifier (zero to remove)
    event ChangedDomainVerifier(
        ISafe indexed safe, bytes32 domainSeparator, ISafeSignatureVerifier oldVerifier, ISafeSignatureVerifier newVerifier
    );

    error StrictUnknownDomain(bytes32 domainSeparator);
    error StrictNotVerifierFormat();
    error StrictHashMismatch();

    function setDomainVerifier(bytes32 domainSeparator, ISafeSignatureVerifier newVerifier) public override onlySelf {
        ISafe safe = ISafe(payable(_msgSender()));
        ISafeSignatureVerifier oldVerifier = domainVerifiers[safe][domainSeparator];
        domainVerifiers[safe][domainSeparator] = newVerifier;
        emit ChangedDomainVerifier(safe, domainSeparator, oldVerifier, newVerifier);
    }

    /// @notice ERC-1271 with no default path: only registered domain verifiers can validate.
    function isValidSignature(bytes32 _hash, bytes calldata signature) external view override returns (bytes4) {
        (ISafe safe, address sender) = _getContext();
        if (signature.length < 68 || bytes4(signature[:4]) != SAFE_SIGNATURE_MAGIC_VALUE) revert StrictNotVerifierFormat();
        (bytes32 domainSeparator, bytes32 typeHash, bytes memory encodeData, bytes memory payload) =
            abi.decode(signature[4:], (bytes32, bytes32, bytes, bytes));
        ISafeSignatureVerifier verifier = domainVerifiers[safe][domainSeparator];
        if (address(verifier) == address(0)) revert StrictUnknownDomain(domainSeparator);
        if (
            keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator, keccak256(abi.encodePacked(typeHash, encodeData))))
                != _hash
        ) revert StrictHashMismatch();
        return verifier.isValidSafeSignature(safe, sender, _hash, domainSeparator, typeHash, encodeData, payload);
    }

    function _supportsInterface(bytes4 interfaceId) internal pure override returns (bool) {
        return interfaceId == type(ERC721TokenReceiver).interfaceId || interfaceId == type(ERC1155TokenReceiver).interfaceId
            || interfaceId == type(ERC1271).interfaceId || interfaceId == type(ISignatureVerifierMuxer).interfaceId
            || interfaceId == type(ERC165Handler).interfaceId || interfaceId == type(IFallbackHandler).interfaceId;
    }
}
