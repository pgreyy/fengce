// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "./TxFacts.sol";

/// @title ApprovalScan
/// @notice Finds approvals an account already granted, which would let a spender move funds with
/// no transaction from the account (so no guard ever sees it). For every token and every spender
/// (Permit2 is always added as a spender) it reads:
/// - ERC-20 `allowance(account, spender)`
/// - Permit2 `allowance(account, token, spender)`, counted while unexpired
/// - ERC-721/1155 `isApprovedForAll(account, spender)`
/// A read that fails or returns malformed data is skipped (the token does not have that function).
/// Event logs are not scanned: X Layer RPCs limit eth_getLogs to 100 blocks, so the caller supplies
/// the token and spender lists.
library ApprovalScan {
    enum FindingKind {
        Erc20Allowance,
        Permit2Allowance,
        ApprovedForAll
    }

    struct Finding {
        FindingKind kind;
        address token;
        address spender;
        uint256 amount;
    }

    bytes4 internal constant IS_APPROVED_FOR_ALL = 0xe985e9c5;
    bytes4 internal constant PERMIT2_ALLOWANCE = 0x927da105; // allowance(address,address,address)

    function scan(address account, address[] memory tokens, address[] memory spenders)
        internal
        view
        returns (Finding[] memory out)
    {
        uint256 nS = spenders.length + 1;
        Finding[] memory tmp = new Finding[](tokens.length * nS * 3);
        uint256 n;
        for (uint256 t; t < tokens.length; t++) {
            for (uint256 s; s < nS; s++) {
                address sp = s < spenders.length ? spenders[s] : TxFacts.PERMIT2;
                n = _one(account, tokens[t], sp, tmp, n);
            }
        }
        out = new Finding[](n);
        for (uint256 i; i < n; i++) {
            out[i] = tmp[i];
        }
    }

    function _one(address account, address token, address spender, Finding[] memory tmp, uint256 n)
        private
        view
        returns (uint256)
    {
        (bool ok, uint256 w) = TxFacts.staticWord(token, abi.encodeWithSelector(TxFacts.ALLOWANCE, account, spender));
        if (ok && w != 0) tmp[n++] = Finding(FindingKind.Erc20Allowance, token, spender, w);

        (ok, w) = TxFacts.staticWord(token, abi.encodeWithSelector(IS_APPROVED_FOR_ALL, account, spender));
        if (ok && w == 1) tmp[n++] = Finding(FindingKind.ApprovedForAll, token, spender, type(uint256).max);

        (uint256 amount, uint256 expiration) = _permit2(account, token, spender);
        if (amount != 0 && expiration >= block.timestamp) {
            tmp[n++] = Finding(FindingKind.Permit2Allowance, token, spender, amount);
        }
        return n;
    }

    function _permit2(address account, address token, address spender)
        private
        view
        returns (uint256 amount, uint256 expiration)
    {
        if (TxFacts.PERMIT2.code.length == 0) return (0, 0);
        bytes memory data = abi.encodeWithSelector(PERMIT2_ALLOWANCE, account, token, spender);
        address p2 = TxFacts.PERMIT2;
        bool ok;
        assembly {
            let m := mload(0x40)
            ok := staticcall(50000, p2, add(data, 32), mload(data), m, 96)
            if iszero(eq(returndatasize(), 96)) { ok := 0 }
            if ok {
                amount := mload(m)
                expiration := mload(add(m, 32))
            }
        }
        if (!ok) return (0, 0);
    }
}
