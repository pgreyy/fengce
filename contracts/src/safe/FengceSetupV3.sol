// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {V3Lib} from "../../script/V3Lib.sol";
import {LimitsLib} from "../../script/LimitsLib.sol";

interface ICatalogSetup {
    function payInstall(bytes32 pinId) external payable;
}

/// @notice Installs FengceGuardV3 while a Safe is being created, so a new Safe with limits takes one signature.
/// The Safe's `setup(owners, threshold, to, data, ...)` delegatecalls `setup(p)` here: the code runs inside the new
/// Safe (address(this) is the Safe), builds the same install as script/V3Lib.sol for that address and runs it through
/// MultiSendCallOnly, so every call (configure, Tick groups, setRules, setGuard, setModuleGuard) comes from the Safe.
/// It holds no state and cannot act on a Safe that already exists: Safe `setup` runs only once.
contract FengceSetupV3 {
    address private immutable self;

    error FengceSetupDirectCall();
    error FengceSetupFailed(bytes reason);

    constructor() {
        self = address(this);
    }

    function setup(V3Lib.Install memory p) external {
        _install(p);
    }

    /// @notice Same, and first pays a paid Catalog listing's install fee from the new Safe's balance (send the OKB to
    /// the Safe's address before creating it). Runs before the guard is on, so the fee call needs no guard support.
    function setupWithCatalogFee(V3Lib.Install memory p, address catalog, bytes32 pinId, uint256 fee) external {
        if (address(this) == self) revert FengceSetupDirectCall();
        ICatalogSetup(catalog).payInstall{value: fee}(pinId);
        _install(p);
    }

    function _install(V3Lib.Install memory p) private {
        if (address(this) == self) revert FengceSetupDirectCall();
        p.safe = address(this);
        (bool ok, bytes memory ret) = LimitsLib.MSCO.delegatecall(V3Lib.installMultiSend(p));
        if (!ok) revert FengceSetupFailed(ret);
    }
}
