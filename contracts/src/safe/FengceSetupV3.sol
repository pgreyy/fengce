// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {V3Lib} from "../../script/V3Lib.sol";
import {LimitsLib} from "../../script/LimitsLib.sol";

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
        if (address(this) == self) revert FengceSetupDirectCall();
        p.safe = address(this);
        (bool ok, bytes memory ret) = LimitsLib.MSCO.delegatecall(V3Lib.installMultiSend(p));
        if (!ok) revert FengceSetupFailed(ret);
    }
}
