// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {Schema} from "../core/Schema.sol";
import {VerdictTypes} from "./VerdictTypes.sol";
import {Market, IERC20Min} from "./Market.sol";

/// @title MarketFactory
/// @notice Creates Verdict markets from a rule template (a pinned circuit with its schema) plus
/// committed parameters and a native data plan. Checks at creation that the rule circuit (and the
/// data source, if pinned) is pinned and that the schema is the one the pin committed to.
/// Imports only src/core.
contract MarketFactory {
    PinRegistry public immutable registry;
    IERC20Min public immutable token;
    uint256 public immutable evalGasCap;
    uint16 public immutable feeBps;
    address public immutable feeRecipient;
    address public immutable reserve;
    uint64 public immutable settleWindow;
    uint64 public immutable claimPeriod;

    address[] public markets;

    event MarketCreated(
        address indexed market,
        uint256 indexed index,
        bytes32 indexed pinId,
        bytes32 dataPlanHash,
        uint64 cutoff,
        uint64 observationTime,
        VerdictTypes.Binding[] bindings,
        VerdictTypes.DataPlan plan
    );

    error FactoryNotPinned(bytes32 pinId);
    error FactorySchemaMismatch();
    error FactoryBadTimes();
    error FactoryBadSource();
    error FactoryBadTerms();

    constructor(
        PinRegistry registry_,
        IERC20Min token_,
        uint256 evalGasCap_,
        uint16 feeBps_,
        address feeRecipient_,
        address reserve_,
        uint64 settleWindow_,
        uint64 claimPeriod_
    ) {
        if (feeBps_ > 1_000 || settleWindow_ == 0 || feeRecipient_ == address(0) || reserve_ == address(0)) {
            revert FactoryBadTerms();
        }
        registry = registry_;
        token = token_;
        evalGasCap = evalGasCap_;
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        reserve = reserve_;
        settleWindow = settleWindow_;
        claimPeriod = claimPeriod_;
    }

    function createMarket(VerdictTypes.MarketSpec calldata spec) external returns (address market) {
        _check(spec);
        bytes32 planHash = keccak256(abi.encode(spec.plan));
        Market.Terms memory terms = Market.Terms(token, feeBps, feeRecipient, reserve, settleWindow, claimPeriod);
        market = address(new Market(registry, evalGasCap, spec, planHash, terms));
        markets.push(market);
        emit MarketCreated(
            market, markets.length - 1, spec.pinId, planHash, spec.cutoff, spec.observationTime, spec.bindings, spec.plan
        );
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function _check(VerdictTypes.MarketSpec calldata spec) private view {
        if (registry.kindOf(spec.pinId) != PinRegistry.Kind.Circuit || !registry.isPinned(spec.pinId)) {
            revert FactoryNotPinned(spec.pinId);
        }
        (,, uint32 nIn,, bytes32 netlistHash, bytes32 schemaHash) = registry.evalInfo(spec.pinId);
        Schema.Layout memory l = spec.layout;
        if (Schema.hash(l) != schemaHash || l.nIn != nIn || l.netlistHash != netlistHash) revert FactorySchemaMismatch();
        Schema.validate(l);
        uint256 needed;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (spec.bindings.length != needed) revert FactorySchemaMismatch();

        if (spec.cutoff <= block.timestamp || spec.cutoff > spec.observationTime) revert FactoryBadTimes();
        if (spec.plan.source.code.length == 0) revert FactoryBadSource();
        if (spec.plan.sourcePinId != bytes32(0) && !registry.isPinned(spec.plan.sourcePinId)) {
            revert FactoryNotPinned(spec.plan.sourcePinId);
        }
    }
}
