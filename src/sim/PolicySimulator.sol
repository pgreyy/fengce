// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {ITapeOutFactory} from "../core/interfaces/ITapeOut.sol";

/// @dev Evaluation helper deployed inside the simulation.
contract SimEngine is PolicyEngine {
    constructor(PinRegistry r) PolicyEngine(r, 30_000_000) {}

    function facts(address account, address to, uint256 value, bytes calldata data)
        external
        view
        returns (TxFacts.Facts memory f)
    {
        f = TxFacts.decode(account, to, value, data, false);
        f.account = account;
    }

    function encode(Schema.Layout calldata l, TxFacts.Binding[] calldata b, TxFacts.Facts calldata f)
        external
        pure
        returns (bytes memory)
    {
        return Schema.encode(l, TxFacts.values(f, b));
    }

    function run(bytes32 pinId, bytes calldata input) external view returns (bytes memory) {
        return _evaluate(pinId, input);
    }
}

/// @title PolicySimulator
/// @notice Read-only simulation of a proposed transaction through a Fengce policy, for `eth_call` with
/// this contract's creation code (no `to`): the constructor pins the circuit in a fresh PinRegistry,
/// decodes the transaction into facts, encodes the circuit input with the schema, evaluates the
/// circuit, and returns the result as the call's return data. Nothing is deployed on chain.
///
/// Return data: abi.encode(uint8 stage, TxFacts.Facts facts, bytes input, bytes output, bytes error)
/// stage: 0 evaluated (decision = output bit 0), 1 pin failed, 2 decode failed (call not recognised),
/// 3 encode failed (value does not fit the schema), 4 evaluation failed.
contract PolicySimulator {
    constructor(
        address factory,
        address processor,
        uint256 circuitId,
        Schema.Layout memory layout,
        TxFacts.Binding[] memory bindings,
        address account,
        address to,
        uint256 value,
        bytes memory data
    ) {
        bytes memory result = _simulate(factory, processor, circuitId, layout, bindings, account, to, value, data);
        assembly {
            return(add(result, 32), mload(result))
        }
    }

    function _simulate(
        address factory,
        address processor,
        uint256 circuitId,
        Schema.Layout memory layout,
        TxFacts.Binding[] memory bindings,
        address account,
        address to,
        uint256 value,
        bytes memory data
    ) private returns (bytes memory) {
        TxFacts.Facts memory f;
        PinRegistry reg = new PinRegistry(ITapeOutFactory(factory));
        bytes32 pinId;
        try reg.pin(processor, circuitId, Schema.hash(layout), bytes32(0)) returns (bytes32 id) {
            pinId = id;
        } catch (bytes memory err) {
            return abi.encode(uint8(1), f, bytes(""), bytes(""), err);
        }
        SimEngine eng = new SimEngine(reg);
        try eng.facts(account, to, value, data) returns (TxFacts.Facts memory got) {
            f = got;
        } catch (bytes memory err) {
            return abi.encode(uint8(2), f, bytes(""), bytes(""), err);
        }
        bytes memory input;
        try eng.encode(layout, bindings, f) returns (bytes memory got) {
            input = got;
        } catch (bytes memory err) {
            return abi.encode(uint8(3), f, bytes(""), bytes(""), err);
        }
        try eng.run(pinId, input) returns (bytes memory out) {
            return abi.encode(uint8(0), f, input, out, bytes(""));
        } catch (bytes memory err) {
            return abi.encode(uint8(4), f, input, bytes(""), err);
        }
    }
}
