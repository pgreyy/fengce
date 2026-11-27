// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ApprovalScan} from "../../src/core/ApprovalScan.sol";
import {TxFacts} from "../../src/core/TxFacts.sol";

contract ScanHarness {
    function scan(address a, address[] memory t, address[] memory s) external view returns (ApprovalScan.Finding[] memory) {
        return ApprovalScan.scan(a, t, s);
    }
}

contract Token20 {
    mapping(address => mapping(address => uint256)) public allowance;

    function set(address o, address s, uint256 v) external {
        allowance[o][s] = v;
    }
}

contract Nft {
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function set(address o, address s, bool v) external {
        isApprovedForAll[o][s] = v;
    }
}

contract Permit2Mock {
    struct A {
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    mapping(address => mapping(address => mapping(address => A))) internal a;

    function set(address o, address t, address s, uint160 amt, uint48 exp) external {
        a[o][t][s] = A(amt, exp, 0);
    }

    function allowance(address o, address t, address s) external view returns (uint160, uint48, uint48) {
        A memory x = a[o][t][s];
        return (x.amount, x.expiration, x.nonce);
    }
}

contract Reverter {
    fallback() external {
        revert("no");
    }
}

contract ApprovalScanTest is Test {
    ScanHarness h = new ScanHarness();
    address safe = makeAddr("safe");
    address spender = makeAddr("spender");
    Token20 t20;
    Nft nft;
    Permit2Mock p2;

    function setUp() public {
        t20 = new Token20();
        nft = new Nft();
        vm.etch(TxFacts.PERMIT2, address(new Permit2Mock()).code);
        p2 = Permit2Mock(TxFacts.PERMIT2);
        vm.warp(1_000_000);
    }

    function _one(address x) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = x;
    }

    function test_findsErc20AllowanceIncludingPermit2AsSpender() public {
        t20.set(safe, spender, 5);
        t20.set(safe, TxFacts.PERMIT2, type(uint256).max);
        ApprovalScan.Finding[] memory f = h.scan(safe, _one(address(t20)), _one(spender));
        assertEq(f.length, 2);
        assertEq(uint256(f[0].kind), uint256(ApprovalScan.FindingKind.Erc20Allowance));
        assertEq(f[0].spender, spender);
        assertEq(f[0].amount, 5);
        assertEq(f[1].spender, TxFacts.PERMIT2); // added even though not in the spender list
    }

    function test_findsUnexpiredPermit2AllowanceOnly() public {
        p2.set(safe, address(t20), spender, 7, uint48(block.timestamp + 1));
        ApprovalScan.Finding[] memory f = h.scan(safe, _one(address(t20)), _one(spender));
        assertEq(f.length, 1);
        assertEq(uint256(f[0].kind), uint256(ApprovalScan.FindingKind.Permit2Allowance));
        assertEq(f[0].amount, 7);

        p2.set(safe, address(t20), spender, 7, uint48(block.timestamp - 1));
        assertEq(h.scan(safe, _one(address(t20)), _one(spender)).length, 0);
    }

    function test_findsApprovedForAll() public {
        nft.set(safe, spender, true);
        ApprovalScan.Finding[] memory f = h.scan(safe, _one(address(nft)), _one(spender));
        assertEq(f.length, 1);
        assertEq(uint256(f[0].kind), uint256(ApprovalScan.FindingKind.ApprovedForAll));
        assertEq(f[0].amount, type(uint256).max);
    }

    function test_skipsTokensThatRevertOrHaveNoCode() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(new Reverter());
        tokens[1] = makeAddr("eoa");
        assertEq(h.scan(safe, tokens, _one(spender)).length, 0);
    }
}
