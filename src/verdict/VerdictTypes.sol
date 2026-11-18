// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Schema} from "../core/Schema.sol";

/// @title VerdictTypes
/// @notice Shared types for Verdict markets. A market freezes a rule (pinned circuit + schema +
/// bindings with committed parameters) and a data plan (where the observed value comes from).
library VerdictTypes {
    /// @notice What feeds one non-Flag schema field, in field order.
    enum Source {
        Observed, // the value read from the data plan
        Param, // the committed literal `arg`
        ObservedGeParam, // 1 if observed >= arg
        ObservedLtParam // 1 if observed < arg
    }

    struct Binding {
        Source source;
        uint256 arg;
    }

    /// @notice Native data plan: one staticcall on X Layer, read in the settlement transaction.
    /// The call must return exactly one 32-byte word, read as uint256.
    struct DataPlan {
        address source; // e.g. the TapeOut factory
        bytes callData; // e.g. cpuCount()
        bytes32 sourcePinId; // optional PinRegistry pin of the source (0 = none); unpinned at settlement -> INVALID
        string description; // human-readable rule and data plan, emitted at creation
    }

    struct MarketSpec {
        bytes32 pinId; // pinned rule circuit
        Schema.Layout layout; // must match the pin's schemaHash
        Binding[] bindings;
        DataPlan plan;
        uint64 cutoff; // last moment to bet (exclusive)
        uint64 observationTime; // T: settlement allowed from T, never before
    }

    function values(Binding[] memory b, uint256 observed) internal pure returns (uint256[] memory v) {
        v = new uint256[](b.length);
        for (uint256 i; i < b.length; i++) {
            Source s = b[i].source;
            if (s == Source.Observed) v[i] = observed;
            else if (s == Source.Param) v[i] = b[i].arg;
            else if (s == Source.ObservedGeParam) v[i] = observed >= b[i].arg ? 1 : 0;
            else v[i] = observed < b[i].arg ? 1 : 0;
        }
    }
}
