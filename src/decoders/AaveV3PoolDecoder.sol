// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../core/TxFacts.sol";
import {IFengceDecoder} from "../core/interfaces/IFengceDecoder.sol";

/// @title AaveV3PoolDecoder
/// @notice Decoder for the Aave V3 Pool: supply, withdraw, borrow, repay. Lending facts:
/// action, token = asset, amount, recipient = onBehalfOf (for withdraw: `to`).
contract AaveV3PoolDecoder is IFengceDecoder {
    bytes4 public constant SUPPLY = 0x617ba037;
    bytes4 public constant WITHDRAW = 0x69328dec;
    bytes4 public constant BORROW = 0xa415bcad;
    bytes4 public constant REPAY = 0x573ade81;

    error DecoderUnsupported(bytes4 selector);

    function decode(address account, address target, uint256 value, bytes calldata data)
        external
        pure
        override
        returns (TxFacts.Facts memory f)
    {
        bytes4 sel = bytes4(data[:4]);
        f = TxFacts.base(TxFacts.Kind.Lending, account, target, value, address(0), 0, sel);
        if (sel == SUPPLY) {
            (address asset, uint256 amount, address onBehalfOf,) = abi.decode(data[4:], (address, uint256, address, uint16));
            (f.action, f.token, f.amount, f.recipient) = (TxFacts.LendingAction.Supply, asset, amount, onBehalfOf);
        } else if (sel == WITHDRAW) {
            (address asset, uint256 amount, address to) = abi.decode(data[4:], (address, uint256, address));
            (f.action, f.token, f.amount, f.recipient) = (TxFacts.LendingAction.Withdraw, asset, amount, to);
        } else if (sel == BORROW) {
            (address asset, uint256 amount,,, address onBehalfOf) =
                abi.decode(data[4:], (address, uint256, uint256, uint16, address));
            (f.action, f.token, f.amount, f.recipient) = (TxFacts.LendingAction.Borrow, asset, amount, onBehalfOf);
        } else if (sel == REPAY) {
            (address asset, uint256 amount,, address onBehalfOf) = abi.decode(data[4:], (address, uint256, uint256, address));
            (f.action, f.token, f.amount, f.recipient) = (TxFacts.LendingAction.Repay, asset, amount, onBehalfOf);
        } else {
            revert DecoderUnsupported(sel);
        }
    }
}
