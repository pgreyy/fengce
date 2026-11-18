// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../TxFacts.sol";

/// @title IFengcePolicy
/// @notice What every Fengce adapter (Safe guard, ERC-7579 hook) exposes: evaluate an account's pinned
/// policy on a canonical context (TxFacts.Facts, docs/POLICY-INTERFACE.md). Reverts unless the circuit
/// allows; returns the circuit input and output bits so callers can show or log them.
interface IFengcePolicy {
    /// @notice Version of the canonical context this adapter understands (1).
    function policyContextVersion() external pure returns (uint16);

    function checkContext(address account, TxFacts.Facts calldata ctx)
        external
        view
        returns (bytes memory input, bytes memory output);
}
