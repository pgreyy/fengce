// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TxFacts
/// @notice Wallet-agnostic decoding of one outgoing call into policy facts, and the mapping of
/// those facts onto circuit input fields. Facts are always derived from the call itself (plus
/// on-chain reads), never supplied by the caller.
///
/// Recognised calls:
/// - empty calldata: Native {to, value, amount = value}
/// - ERC-20 transfer: Transfer {to = recipient, token, amount}
/// - approve: Approval {to = spender, token, amount}; for an ERC-721 token (ERC-165) amount = max
/// - increaseAllowance: Approval with amount = current allowance + added (the new total)
/// - setApprovalForAll: Approval with amount = max (true) or 0 (false); true needs the allowlist
/// - Permit2 approve: Approval {token, to = spender, amount}
/// - any other call whose (target, selector) the wallet allowlisted: Call {to, value, selector}
/// Everything else is rejected (fail closed).
library TxFacts {
    enum Kind {
        Native,
        Transfer,
        Approval,
        Call
    }

    /// @notice What feeds one non-Flag schema field, in field order.
    enum Source {
        To, // recipient, spender or call target, as uint160
        Value, // native value
        Token, // token contract, 0 for native and plain calls
        Amount, // native value, transfer amount or approval amount
        Kind, // uint(Kind)
        AmountGt, // 1 if amount > param
        ToIs, // 1 if to == address(param)
        TokenIs, // 1 if token == address(param)
        Selector // uint32 selector, 0 for native
    }

    struct Facts {
        Kind kind;
        address to;
        uint256 value;
        address token;
        uint256 amount;
        bytes4 selector;
    }

    struct Binding {
        Source source;
        uint256 param;
    }

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes4 internal constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant APPROVE = 0x095ea7b3; // approve(address,uint256), ERC-20 and ERC-721
    bytes4 internal constant INCREASE_ALLOWANCE = 0x39509351; // increaseAllowance(address,uint256)
    bytes4 internal constant SET_APPROVAL_FOR_ALL = 0xa22cb465; // setApprovalForAll(address,bool)
    bytes4 internal constant PERMIT2_APPROVE = 0x87517c45; // approve(address,address,uint160,uint48)
    bytes4 internal constant ALLOWANCE = 0xdd62ed3e; // allowance(address,address)
    bytes4 internal constant ERC721_ID = 0x80ac58cd;
    uint256 internal constant READ_GAS = 50_000;

    error TxUnsupportedCall(address target, bytes4 selector);
    error TxApprovalForAllDenied(address token, address operator);
    error TxAllowanceUnreadable(address token);

    /// @param account the wallet making the call (for allowance reads)
    /// @param allowlisted whether the wallet allowlisted (target, selector of data)
    function decode(address account, address target, uint256 value, bytes memory data, bool allowlisted)
        internal
        view
        returns (Facts memory f)
    {
        if (data.length == 0) return Facts(Kind.Native, target, value, address(0), value, bytes4(0));
        bytes4 sel = selectorOf(data);

        if (value == 0 && data.length == 68) {
            uint256 a = _word(data, 0);
            uint256 b = _word(data, 1);
            if (a >> 160 == 0) {
                address who = address(uint160(a));
                if (sel == TRANSFER) return Facts(Kind.Transfer, who, 0, target, b, sel);
                if (sel == APPROVE) {
                    uint256 amt = _isErc721(target) ? type(uint256).max : b;
                    return Facts(Kind.Approval, who, 0, target, amt, sel);
                }
                if (sel == INCREASE_ALLOWANCE) {
                    uint256 cur = _allowance(target, account, who);
                    uint256 total = cur > type(uint256).max - b ? type(uint256).max : cur + b;
                    return Facts(Kind.Approval, who, 0, target, total, sel);
                }
                if (sel == SET_APPROVAL_FOR_ALL && b <= 1) {
                    if (b == 1 && !allowlisted) revert TxApprovalForAllDenied(target, who);
                    return Facts(Kind.Approval, who, 0, target, b == 1 ? type(uint256).max : 0, sel);
                }
            }
        }

        if (value == 0 && target == PERMIT2 && sel == PERMIT2_APPROVE && data.length == 132) {
            uint256 token = _word(data, 0);
            uint256 spender = _word(data, 1);
            uint256 amt = _word(data, 2);
            uint256 exp = _word(data, 3);
            if (token >> 160 == 0 && spender >> 160 == 0 && amt >> 160 == 0 && exp >> 48 == 0) {
                return Facts(Kind.Approval, address(uint160(spender)), 0, address(uint160(token)), amt, sel);
            }
        }

        if (allowlisted) return Facts(Kind.Call, target, value, address(0), value, sel);
        revert TxUnsupportedCall(target, sel);
    }

    function values(Facts memory f, Binding[] memory b) internal pure returns (uint256[] memory v) {
        v = new uint256[](b.length);
        for (uint256 i; i < b.length; i++) {
            Source s = b[i].source;
            uint256 p = b[i].param;
            if (s == Source.To) v[i] = uint160(f.to);
            else if (s == Source.Value) v[i] = f.value;
            else if (s == Source.Token) v[i] = uint160(f.token);
            else if (s == Source.Amount) v[i] = f.amount;
            else if (s == Source.Kind) v[i] = uint256(f.kind);
            else if (s == Source.AmountGt) v[i] = f.amount > p ? 1 : 0;
            else if (s == Source.ToIs) v[i] = uint160(f.to) == p ? 1 : 0;
            else if (s == Source.TokenIs) v[i] = uint160(f.token) == p ? 1 : 0;
            else v[i] = uint32(f.selector); // Selector
        }
    }

    function selectorOf(bytes memory data) internal pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(data, 32))
        }
    }

    /// @dev Argument word `i` after the selector. Caller checks the length.
    function _word(bytes memory data, uint256 i) private pure returns (uint256 w) {
        assembly {
            w := mload(add(add(data, 36), mul(i, 32)))
        }
    }

    function _isErc721(address token) private view returns (bool) {
        (bool ok, uint256 w) = staticWord(token, abi.encodeWithSelector(0x01ffc9a7, ERC721_ID));
        return ok && w == 1;
    }

    function _allowance(address token, address owner, address spender) private view returns (uint256) {
        (bool ok, uint256 w) = staticWord(token, abi.encodeWithSelector(ALLOWANCE, owner, spender));
        if (!ok) revert TxAllowanceUnreadable(token);
        return w;
    }

    /// @notice Staticcall with a gas cap, copying back at most one word. ok only if the call
    /// succeeded and returned exactly 32 bytes.
    function staticWord(address target, bytes memory data) internal view returns (bool ok, uint256 w) {
        uint256 g = READ_GAS;
        assembly {
            ok := staticcall(g, target, add(data, 32), mload(data), 0, 0)
            if iszero(eq(returndatasize(), 32)) { ok := 0 }
            if ok {
                returndatacopy(0, 0, 32)
                w := mload(0)
            }
        }
    }
}
