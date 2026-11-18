// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Schema} from "../Schema.sol";

/// @title IPolicyEngine
/// @notice External surface of PolicyEngine: evaluates a pinned TapeOut circuit and fails closed
/// (reverts) on any pin mismatch, call failure, out-of-gas, malformed return data or wrong length.
interface IPolicyEngine {
    error EngineNotPinned(bytes32 pinId);
    error EngineInputLength(uint256 given, uint256 expected);
    error EngineInputPadding();
    error EngineSchemaMismatch(bytes32 pinId);
    error EngineEvalFailed(bytes32 pinId);
    error EngineOutputLength(uint256 given, uint256 expected);
    error EngineOutputPadding();

    /// @notice The PinRegistry consulted on every evaluation.
    function registry() external view returns (address);
    /// @notice Gas forwarded to the circuit's `eval`.
    function evalGasCap() external view returns (uint256);

    /// @notice Evaluates on raw input: exactly ceil(nIn/8) bytes with zero padding. Returns exactly
    /// ceil(nOut/8) output bytes.
    function evaluate(bytes32 pinId, bytes memory input) external view returns (bytes memory);

    /// @notice Encodes typed values with `layout` (which must be the pin's schema) and evaluates.
    function evaluateFields(bytes32 pinId, Schema.Layout memory layout, uint256[] memory values)
        external
        view
        returns (bytes memory);
}
