// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../core/TxFacts.sol";
import {IFengceDecoder} from "../core/interfaces/IFengceDecoder.sol";

/// @title UniswapV3RouterDecoder
/// @notice Decoder for Uniswap SwapRouter02 (IV3SwapRouter, no deadline in the call):
/// exactInputSingle, exactInput, exactOutputSingle, exactOutput. Swap facts: token = tokenIn,
/// amount = amountIn (exact input) or amountInMaximum (exact output), tokenOut, minAmountOut =
/// amountOutMinimum or the exact amountOut, recipient. SwapRouter02's recipient shortcuts are resolved:
/// address(1) = the caller (the account), address(2) = the router itself.
contract UniswapV3RouterDecoder is IFengceDecoder {
    bytes4 public constant EXACT_INPUT_SINGLE = 0x04e45aaf;
    bytes4 public constant EXACT_INPUT = 0xb858183f;
    bytes4 public constant EXACT_OUTPUT_SINGLE = 0x5023b4df;
    bytes4 public constant EXACT_OUTPUT = 0x09b81346;

    struct Single {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amount; // amountIn or amountOut
        uint256 limit; // amountOutMinimum or amountInMaximum
        uint160 sqrtPriceLimitX96;
    }

    struct Path {
        bytes path;
        address recipient;
        uint256 amount; // amountIn or amountOut
        uint256 limit; // amountOutMinimum or amountInMaximum
    }

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
        if (sel == EXACT_INPUT_SINGLE || sel == EXACT_OUTPUT_SINGLE) {
            Single memory p = abi.decode(data[4:], (Single));
            f.token = p.tokenIn;
            f.tokenOut = p.tokenOut;
            f.recipient = _recipient(p.recipient, account, target);
            if (sel == EXACT_INPUT_SINGLE) (f.amount, f.minAmountOut) = (p.amount, p.limit);
            else (f.amount, f.minAmountOut) = (p.limit, p.amount);
        } else if (sel == EXACT_INPUT || sel == EXACT_OUTPUT) {
            Path memory p = abi.decode(data[4:], (Path));
            if (p.path.length < 43 || (p.path.length - 20) % 23 != 0) revert DecoderBadPath();
            (address first, address last) = (_addr(p.path, 0), _addr(p.path, p.path.length - 20));
            // exactOutput paths are encoded output first
            (f.token, f.tokenOut) = sel == EXACT_INPUT ? (first, last) : (last, first);
            f.recipient = _recipient(p.recipient, account, target);
            if (sel == EXACT_INPUT) (f.amount, f.minAmountOut) = (p.amount, p.limit);
            else (f.amount, f.minAmountOut) = (p.limit, p.amount);
        } else {
            revert DecoderUnsupported(sel);
        }
    }

    function _recipient(address r, address account, address router) private pure returns (address) {
        if (r == address(1)) return account;
        if (r == address(2)) return router;
        return r;
    }

    function _addr(bytes memory b, uint256 at) private pure returns (address a) {
        assembly {
            a := shr(96, mload(add(add(b, 32), at)))
        }
    }
}
