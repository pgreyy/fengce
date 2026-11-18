// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../TxFacts.sol";

/// @title IFengceDecoder
/// @notice Turns one protocol call into the canonical policy context (TxFacts.Facts, version 1).
/// A wallet registers a decoder per (target, selector); registered calls reach the circuit with these
/// facts instead of the generic ones. A decoder must revert on any call it cannot decode exactly.
interface IFengceDecoder {
    function decode(address account, address target, uint256 value, bytes calldata data)
        external
        view
        returns (TxFacts.Facts memory);
}
