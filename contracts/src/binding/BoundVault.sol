// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FengceBinding} from "./FengceBinding.sol";
import {BoundOnlyBase} from "./BoundOnly.sol";

/// @title BoundVault
/// @notice Sample integration: a native-currency vault that accepts deposits only from accounts bound to a
/// given Fengce policy with at least one day of notice before any change. Withdrawals go back to the
/// depositor only.
contract BoundVault is BoundOnlyBase {
    uint256 public constant MIN_NOTICE_FLOOR = 1 days;

    mapping(address => uint256) public balanceOf;

    /// @notice A bound account deposited.
    /// @param account Depositor
    /// @param amount Amount
    event Deposited(address indexed account, uint256 amount);
    /// @notice A depositor withdrew.
    /// @param account Depositor
    /// @param amount Amount
    event Withdrawn(address indexed account, uint256 amount);

    error VaultNoticeTooShort(uint256 minNotice);
    error VaultTransferFailed();

    constructor(FengceBinding binding_, bytes32 requiredPolicy_, uint256 minNotice_)
        BoundOnlyBase(binding_, requiredPolicy_, minNotice_)
    {
        if (minNotice_ < MIN_NOTICE_FLOOR) revert VaultNoticeTooShort(minNotice_);
    }

    function deposit() external payable onlyBound {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert VaultTransferFailed();
    }
}
