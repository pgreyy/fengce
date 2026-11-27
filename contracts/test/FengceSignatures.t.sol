// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {SafeAdmin} from "../src/safe/SafeAdmin.sol";
import {FengceSignatureVerifier} from "../src/safe/FengceSignatureVerifier.sol";
import {FengceStrictHandler} from "../src/safe/FengceStrictHandler.sol";
import {ForkBase} from "./utils/ForkBase.sol";

interface IPermit2 {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function permit(address owner, PermitSingle memory permitSingle, bytes calldata signature) external;
    function allowance(address owner, address token, address spender) external view returns (uint160, uint48, uint48);
}

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// Fork tests on live X Layer: off-chain approvals signed by a Safe go through the Fengce policy via a
/// domain verifier on Safe's ExtensibleFallbackHandler 1.5.0, checked by the real Permit2.
contract FengceSignaturesForkTest is ForkBase {
    address constant EXTENSIBLE_HANDLER = 0x85a8ca358D388530ad0fB95D0cb89Dd44Fc242c3;
    IPermit2 constant P2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    bytes4 constant SAFE_SIGNATURE_MAGIC = 0x5fd7e97d;
    bytes32 constant SAFE_MSG_TYPEHASH = 0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca;

    FengceSignatureVerifier verifier;
    FengceStrictHandler strict;
    address spender = makeAddr("spender");

    function setUp() public {
        _forkAndPin();
        verifier = new FengceSignatureVerifier(guard);
        strict = new FengceStrictHandler();
    }

    /// Safe with `handler`, the Permit2 domain delegated to the Fengce verifier, then Fengce installed.
    function _safe(address handler) internal returns (ISafe safe) {
        safe = _newSafeWithHandler(handler);
        _exec(
            safe,
            address(safe),
            0,
            abi.encodeWithSignature("setDomainVerifier(bytes32,address)", P2.DOMAIN_SEPARATOR(), address(verifier))
        );
        _install(safe);
    }

    function _safeMessageHash(ISafe safe, bytes32 h) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                bytes1(0x19), bytes1(0x01), safe.domainSeparator(), keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(h))))
            )
        );
    }

    /// Owner approval of the Safe message hash (this contract is the only owner), as a v = 1 signature.
    function _ownerSig(ISafe safe, bytes32 h) internal returns (bytes memory) {
        safe.approveHash(_safeMessageHash(safe, h));
        return abi.encodePacked(uint256(uint160(address(this))), uint256(0), uint8(1));
    }

    function _permitSingle(uint160 amount) internal view returns (IPermit2.PermitSingle memory p) {
        p.details = IPermit2.PermitDetails(USDT0, amount, uint48(block.timestamp + 1 days), 0);
        p.spender = spender;
        p.sigDeadline = block.timestamp + 1 hours;
    }

    /// Builds the EIP-712 hash Permit2 will check and the verifier-format signature for it.
    function _sign(ISafe safe, IPermit2.PermitSingle memory p) internal returns (bytes memory sig) {
        bytes32 detailsHash = keccak256(
            abi.encode(
                verifier.PERMIT_DETAILS_TYPEHASH(), p.details.token, p.details.amount, p.details.expiration, p.details.nonce
            )
        );
        bytes memory encodeData = abi.encode(detailsHash, p.spender, p.sigDeadline);
        bytes32 typeHash = verifier.PERMIT_SINGLE_TYPEHASH();
        bytes32 domain = P2.DOMAIN_SEPARATOR();
        bytes32 h = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domain, keccak256(abi.encodePacked(typeHash, encodeData))));
        bytes memory details = abi.encode(
            FengceSignatureVerifier.PermitDetails(p.details.token, p.details.amount, p.details.expiration, p.details.nonce)
        );
        bytes memory payload = abi.encode(details, _ownerSig(safe, h));
        sig = abi.encodePacked(SAFE_SIGNATURE_MAGIC, abi.encode(domain, typeHash, encodeData, payload));
    }

    function test_permit2PermitSingleOverLimitFails_underLimitPasses() public {
        ISafe safe = _safe(EXTENSIBLE_HANDLER);

        IPermit2.PermitSingle memory over = _permitSingle(150);
        bytes memory sigOver = _sign(safe, over);
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), spender));
        P2.permit(address(safe), over, sigOver);

        IPermit2.PermitSingle memory under = _permitSingle(50);
        P2.permit(address(safe), under, _sign(safe, under)); // the real Permit2 accepts it
        (uint160 amount,,) = P2.allowance(address(safe), USDT0, spender);
        assertEq(amount, 50);
    }

    function test_strictModeRejectsUnknownDomain() public {
        bytes32 h = keccak256("some off-chain order on an unknown domain");

        // Default ExtensibleFallbackHandler: a plain owner signature on an unknown domain is accepted.
        ISafe loose = _safe(EXTENSIBLE_HANDLER);
        assertEq(IERC1271(address(loose)).isValidSignature(h, _ownerSig(loose, h)), bytes4(0x1626ba7e));

        // Strict handler: refused, both as a plain signature and in verifier format for an unregistered domain.
        ISafe safe = _safe(address(strict));
        bytes memory plain = _ownerSig(safe, h);
        vm.expectRevert(FengceStrictHandler.StrictNotVerifierFormat.selector);
        IERC1271(address(safe)).isValidSignature(h, plain);

        bytes32 unknownDomain = keccak256("unknown domain");
        bytes memory wrapped = abi.encodePacked(SAFE_SIGNATURE_MAGIC, abi.encode(unknownDomain, bytes32(0), bytes(""), bytes("")));
        vm.expectRevert(abi.encodeWithSelector(FengceStrictHandler.StrictUnknownDomain.selector, unknownDomain));
        IERC1271(address(safe)).isValidSignature(h, wrapped);

        // The registered Permit2 domain still works through the strict handler.
        IPermit2.PermitSingle memory under = _permitSingle(50);
        P2.permit(address(safe), under, _sign(safe, under));
        (uint160 amount,,) = P2.allowance(address(safe), USDT0, spender);
        assertEq(amount, 50);
    }

    function test_changingDomainVerifierOrHandlerIsTimelocked() public {
        ISafe safe = _safe(address(strict));
        bytes memory setVerifier =
            abi.encodeWithSignature("setDomainVerifier(bytes32,address)", P2.DOMAIN_SEPARATOR(), address(0));
        bytes32 id = guard.adminId(address(safe), address(safe), setVerifier);
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, id));
        _exec(safe, address(safe), 0, setVerifier);

        bytes memory setHandler = abi.encodeWithSignature("setFallbackHandler(address)", EXTENSIBLE_HANDLER);
        bytes32 id2 = guard.adminId(address(safe), address(safe), setHandler);
        vm.expectRevert(abi.encodeWithSelector(SafeAdmin.AdminNotReady.selector, id2));
        _exec(safe, address(safe), 0, setHandler);

        assertTrue(_exec(safe, address(guard), 0, abi.encodeCall(SafeAdmin.scheduleAdmin, (address(safe), setVerifier))));
        vm.warp(block.timestamp + DELAY);
        assertTrue(_exec(safe, address(safe), 0, setVerifier));
    }
}
