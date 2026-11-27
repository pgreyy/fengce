// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";
import {Schema} from "./Schema.sol";
import {ITapeOutProcessor} from "./interfaces/ITapeOut.sol";

/// @title PolicyEngine
/// @notice Evaluates a pinned TapeOut circuit, failing closed: any pin mismatch, call failure,
/// out-of-gas, malformed return data or wrong output length reverts. Wallet adapters inherit this
/// contract (or call it) and decide what the output bits mean.
contract PolicyEngine {
    PinRegistry public immutable registry;
    /// @notice Gas forwarded to `eval`.
    uint256 public immutable evalGasCap;

    error EngineNotPinned(bytes32 pinId);
    error EngineInputLength(uint256 given, uint256 expected);
    error EngineInputPadding();
    error EngineSchemaMismatch(bytes32 pinId);
    error EngineEvalFailed(bytes32 pinId);
    error EngineOutputLength(uint256 given, uint256 expected);
    error EngineOutputPadding();

    constructor(PinRegistry registry_, uint256 evalGasCap_) {
        registry = registry_;
        evalGasCap = evalGasCap_;
    }

    /// @notice Evaluates the pinned circuit on raw input bytes, which must be exactly ceil(nIn/8)
    /// bytes with zero padding (no lenient input). Returns exactly ceil(nOut/8) output bytes.
    function evaluate(bytes32 pinId, bytes memory input) public view returns (bytes memory) {
        return _evaluate(pinId, input);
    }

    /// @notice Encodes typed values with `layout` and evaluates. The layout must be the one the pin
    /// committed to (schemaHash) and must be bound to the pinned netlist and input count.
    function evaluateFields(bytes32 pinId, Schema.Layout memory layout, uint256[] memory values)
        public
        view
        returns (bytes memory)
    {
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(pinId);
        if (Schema.hash(layout) != schemaHash || layout.netlistHash != netlistHash || layout.nIn != nIn) {
            revert EngineSchemaMismatch(pinId);
        }
        return _evaluate(pinId, Schema.encode(layout, values));
    }

    function _evaluate(bytes32 pinId, bytes memory input) internal view returns (bytes memory out) {
        if (!registry.isPinned(pinId)) revert EngineNotPinned(pinId);
        (address processor, uint256 circuitId, uint32 nIn, uint32 nOut,,) = registry.evalInfo(pinId);

        uint256 inLen = (uint256(nIn) + 7) / 8;
        if (input.length != inLen) revert EngineInputLength(input.length, inLen);
        if (nIn % 8 != 0 && uint8(input[inLen - 1]) >> (nIn % 8) != 0) revert EngineInputPadding();

        // At most `evalGasCap` is forwarded. Running out of gas, for any reason, is a failure and
        // denies; it can never allow.
        (bool ok, bytes memory ret) =
            processor.staticcall{gas: evalGasCap}(abi.encodeCall(ITapeOutProcessor.eval, (circuitId, input)));
        // ABI bytes: offset word + length word at least.
        if (!ok || ret.length < 64) revert EngineEvalFailed(pinId);
        out = abi.decode(ret, (bytes));

        uint256 outLen = (uint256(nOut) + 7) / 8;
        if (out.length != outLen) revert EngineOutputLength(out.length, outLen);
        if (nOut % 8 != 0 && uint8(out[outLen - 1]) >> (nOut % 8) != 0) revert EngineOutputPadding();
    }
}
