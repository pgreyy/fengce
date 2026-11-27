// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";

import {TxFacts} from "../src/core/TxFacts.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {ForkBase} from "./utils/ForkBase.sol";

/// Minimal ERC-20 with increaseAllowance (OpenZeppelin v4 style).
contract MockToken {
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function increaseAllowance(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] += v;
        return true;
    }
}

/// Minimal ERC-721 surface: ERC-165 says ERC-721, approve(to, tokenId).
contract MockNft {
    mapping(uint256 => address) public getApproved;

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x80ac58cd || id == 0x01ffc9a7;
    }

    function approve(address to, uint256 tokenId) external {
        getApproved[tokenId] = to;
    }
}

contract Pinger {
    uint256 public last;

    function ping(uint256 x) external {
        last = x;
    }
}

/// Fork tests on live X Layer: approval decoding, allowlisted calls, ERC-721 approvals.
contract FengceApprovalsForkTest is ForkBase {
    ISafe safe;
    MockToken token;
    MockNft nftA;
    MockNft nftB;
    Pinger pingA;
    Pinger pingB;
    address spender;

    function setUp() public {
        _forkAndPin();
        safe = _newSafe();
        token = new MockToken();
        nftA = new MockNft();
        nftB = new MockNft();
        pingA = new Pinger();
        pingB = new Pinger();
        spender = makeAddr("spender");

        // Allowlist before the first configuration (afterwards it would need the timelock).
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(pingA), Pinger.ping.selector, true)));
        _exec(safe, address(guard), 0, abi.encodeCall(FengceGuard.setAllowlisted, (address(nftB), MockNft.approve.selector, true)));
        _install(safe);
    }

    function test_increaseAllowanceTwiceCrossingLimitBlocked() public {
        bytes memory inc = abi.encodeCall(MockToken.increaseAllowance, (spender, 60));
        assertTrue(_exec(safe, address(token), 0, inc)); // new total 60
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), address(token)));
        _exec(safe, address(token), 0, inc); // new total would be 120
        assertEq(token.allowance(address(safe), spender), 60);
    }

    function test_permit2ApproveOverLimitBlocked() public {
        uint48 exp = uint48(block.timestamp + 1 days);
        bytes memory over = abi.encodeWithSignature(
            "approve(address,address,uint160,uint48)", USDT0, spender, uint160(150), exp
        );
        vm.expectRevert(abi.encodeWithSelector(FengceGuard.FengceDenied.selector, address(safe), TxFacts.PERMIT2));
        _exec(safe, TxFacts.PERMIT2, 0, over);

        bytes memory within = abi.encodeWithSignature(
            "approve(address,address,uint160,uint48)", USDT0, spender, uint160(50), exp
        );
        assertTrue(_exec(safe, TxFacts.PERMIT2, 0, within)); // real Permit2 on the fork
    }

    function test_allowlistedCallPasses_sameSelectorElsewhereDenied() public {
        bytes memory data = abi.encodeCall(Pinger.ping, (7));
        assertTrue(_exec(safe, address(pingA), 0, data));
        assertEq(pingA.last(), 7);

        vm.expectRevert(abi.encodeWithSelector(TxFacts.TxUnsupportedCall.selector, address(pingB), Pinger.ping.selector));
        _exec(safe, address(pingB), 0, data);
    }

    function test_erc721ApproveBlockedUnlessAllowlisted() public {
        bytes memory data = abi.encodeCall(MockNft.approve, (spender, 7));
        vm.expectRevert(abi.encodeWithSelector(TxFacts.TxNftApprovalDenied.selector, address(nftA), spender));
        _exec(safe, address(nftA), 0, data);

        assertTrue(_exec(safe, address(nftB), 0, data));
        assertEq(nftB.getApproved(7), spender);
    }
}
