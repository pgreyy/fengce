// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TxFacts} from "../../src/core/TxFacts.sol";
import {UniswapV2RouterDecoder} from "../../src/decoders/UniswapV2RouterDecoder.sol";
import {AaveV3PoolDecoder} from "../../src/decoders/AaveV3PoolDecoder.sol";
import {UniswapV3RouterDecoder} from "../../src/decoders/UniswapV3RouterDecoder.sol";

contract DecodersTest is Test {
    address account = makeAddr("safe");
    address router = makeAddr("router");
    address a = makeAddr("tokenA");
    address b = makeAddr("tokenB");

    function test_v2ExactTokensForTokens() public {
        address[] memory path = new address[](3);
        (path[0], path[1], path[2]) = (a, makeAddr("mid"), b);
        bytes memory data = abi.encodeWithSelector(0x38ed1739, 100, 90, path, account, 1234);
        TxFacts.Facts memory f = new UniswapV2RouterDecoder().decode(account, router, 0, data);
        assertEq(uint256(f.kind), uint256(TxFacts.Kind.Swap));
        assertEq(f.token, a);
        assertEq(f.tokenOut, b);
        assertEq(f.amount, 100);
        assertEq(f.minAmountOut, 90);
        assertEq(f.recipient, account);
        assertEq(f.deadline, 1234);
        assertEq(f.account, account);
    }

    function test_v2ExactOutputAndEthInput() public {
        UniswapV2RouterDecoder d = new UniswapV2RouterDecoder();
        address[] memory path = new address[](2);
        (path[0], path[1]) = (a, b);
        TxFacts.Facts memory f = d.decode(account, router, 0, abi.encodeWithSelector(0x8803dbee, 50, 70, path, account, 1));
        assertEq(f.amount, 70); // amountInMax
        assertEq(f.minAmountOut, 50); // exact amountOut
        f = d.decode(account, router, 7 ether, abi.encodeWithSelector(0x7ff36ab5, 3, path, account, 1));
        assertEq(f.amount, 7 ether);
        assertEq(f.minAmountOut, 3);
    }

    function test_aaveActions() public {
        AaveV3PoolDecoder d = new AaveV3PoolDecoder();
        TxFacts.Facts memory f = d.decode(account, router, 0, abi.encodeWithSelector(0x617ba037, a, 5, account, uint16(0)));
        assertEq(uint256(f.action), uint256(TxFacts.LendingAction.Supply));
        assertEq(f.token, a);
        assertEq(f.amount, 5);
        f = d.decode(account, router, 0, abi.encodeWithSelector(0x69328dec, a, 6, b));
        assertEq(uint256(f.action), uint256(TxFacts.LendingAction.Withdraw));
        assertEq(f.recipient, b);
        f = d.decode(account, router, 0, abi.encodeWithSelector(0xa415bcad, a, 7, 2, uint16(0), account));
        assertEq(uint256(f.action), uint256(TxFacts.LendingAction.Borrow));
        f = d.decode(account, router, 0, abi.encodeWithSelector(0x573ade81, a, 8, 2, b));
        assertEq(uint256(f.action), uint256(TxFacts.LendingAction.Repay));
        assertEq(f.recipient, b);
    }

    function test_v3PathAndUnknownSelector() public {
        UniswapV3RouterDecoder d = new UniswapV3RouterDecoder();
        bytes memory path = abi.encodePacked(a, uint24(500), makeAddr("mid"), uint24(3000), b);
        TxFacts.Facts memory f =
            d.decode(account, router, 0, abi.encodeWithSelector(0xb858183f, UniswapV3RouterDecoder.Path(path, address(2), 9, 8)));
        assertEq(f.token, a);
        assertEq(f.tokenOut, b);
        assertEq(f.recipient, router); // ADDRESS_THIS shortcut
        vm.expectRevert(abi.encodeWithSelector(UniswapV3RouterDecoder.DecoderUnsupported.selector, bytes4(0xdeadbeef)));
        d.decode(account, router, 0, hex"deadbeef00");
    }
}
