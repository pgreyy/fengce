// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title FengceLimits
/// @notice The one place for Fengce's fixed safety limits. Every Safe configuration must meet them.
library FengceLimits {
    /// @notice Shortest admin timelock: scheduled admin calls wait at least this long.
    uint64 internal constant MIN_ADMIN_DELAY = 1 days;
    /// @notice Shortest recovery delay: guard changes wait at least this long after all owners sign.
    uint64 internal constant MIN_RECOVERY_DELAY = 2 days;
    /// @notice Shortest recovery window: how long a matured recovery stays usable.
    uint64 internal constant MIN_RECOVERY_WINDOW = 1 days;
    /// @notice Recovery window used while a Safe has no configuration.
    uint64 internal constant DEFAULT_RECOVERY_WINDOW = 7 days;
    /// @notice Modules read per page when checking a Safe's enabled modules.
    uint256 internal constant MODULE_PAGE = 16;
}
