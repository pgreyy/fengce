// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceBinding} from "./FengceBinding.sol";

/// @title BoundOnly
/// @notice Check that a caller is an account bound to a Fengce policy (see FengceBinding).
library BoundOnly {
    error NotBound(address account, bytes32 policyHash, uint256 minNotice);

    function requireBound(FengceBinding binding, address account, bytes32 policyHash, uint256 minNotice) internal view {
        if (!binding.isBound(account, policyHash, minNotice)) revert NotBound(account, policyHash, minNotice);
    }
}

/// @title BoundOnlyBase
/// @notice Inherit to get the `onlyBound` modifier: msg.sender must be bound to `requiredPolicy` with at
/// least `minNotice` seconds before any change to its policy, guards or admin settings can execute.
abstract contract BoundOnlyBase {
    FengceBinding public immutable binding;
    bytes32 public immutable requiredPolicy;
    uint256 public immutable minNotice;

    constructor(FengceBinding binding_, bytes32 requiredPolicy_, uint256 minNotice_) {
        binding = binding_;
        requiredPolicy = requiredPolicy_;
        minNotice = minNotice_;
    }

    modifier onlyBound() {
        BoundOnly.requireBound(binding, msg.sender, requiredPolicy, minNotice);
        _;
    }
}
