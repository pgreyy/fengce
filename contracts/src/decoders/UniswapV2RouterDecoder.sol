// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../core/TxFacts.sol";
import {IFengceDecoder} from "../core/interfaces/IFengceDecoder.sol";

/// @title UniswapV2RouterDecoder
/// @notice Decoder for UniswapV2Router02-style routers: swapExactTokensForTokens,
/// swapTokensForExactTokens, swapExactETHForTokens, swapExactTokensForETH. Swap facts with
/// token = path[0], tokenOut = path[last], recipient = to, deadline. For ETH input, amount = value.
contract UniswapV2RouterDecoder is IFengceDecoder {
    bytes4 public constant EXACT_TOKENS_FOR_TOKENS = 0x38ed1739;
    bytes4 public constant TOKENS_FOR_EXACT_TOKENS = 0x8803dbee;
    bytes4 public constant EXACT_ETH_FOR_TOKENS = 0x7ff36ab5;
    bytes4 public constant EXACT_TOKENS_FOR_ETH = 0x18cbafe5;

    error DecoderUnsupported(bytes4 selector);
    error DecoderBadPath();

    function decode(address account, address target, uint256 value, bytes calldata data)
        external
        pure
        override
        returns (TxFacts.Facts memory f)
    {
        bytes4 sel = bytes4(data[:4]);
        f = TxFacts.base(TxFacts.Kind.Swap, account, target, value, address(0), 0, sel);
        address[] memory path;
        if (sel == EXACT_ETH_FOR_TOKENS) {
            (uint256 minOut, address[] memory p, address to, uint256 deadline) =
                abi.decode(data[4:], (uint256, address[], address, uint256));
            (path, f.amount, f.minAmountOut, f.recipient, f.deadline) = (p, value, minOut, to, deadline);
        } else if (sel == EXACT_TOKENS_FOR_TOKENS || sel == EXACT_TOKENS_FOR_ETH || sel == TOKENS_FOR_EXACT_TOKENS) {
            (uint256 x, uint256 y, address[] memory p, address to, uint256 deadline) =
                abi.decode(data[4:], (uint256, uint256, address[], address, uint256));
            path = p;
            (f.recipient, f.deadline) = (to, deadline);
            // exact-output: (amountOut, amountInMax); exact-input: (amountIn, amountOutMin)
            if (sel == TOKENS_FOR_EXACT_TOKENS) (f.amount, f.minAmountOut) = (y, x);
            else (f.amount, f.minAmountOut) = (x, y);
        } else {
            revert DecoderUnsupported(sel);
        }
        if (path.length < 2) revert DecoderBadPath();
        (f.token, f.tokenOut) = (path[0], path[path.length - 1]);
    }
}
