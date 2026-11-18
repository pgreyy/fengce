// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TxFacts
/// @notice Wallet-agnostic decoding of one outgoing call into policy facts, and the mapping of
/// those facts onto circuit input fields. Facts are always derived from the call itself, never
/// supplied by the caller. Calls that are not a plain native transfer, an ERC-20 `transfer` or an
/// ERC-20 `approve` are rejected (fail closed).
library TxFacts {
    enum Kind {
        Native, // empty calldata, native value
        Erc20Transfer, // transfer(address,uint256)
        Erc20Approve // approve(address,uint256)
    }

    /// @notice What feeds one non-Flag schema field, in field order.
    enum Source {
        To, // recipient (native) or the `to`/`spender` argument (ERC-20), as uint160
        Value, // native value
        Token, // token contract, 0 for native
        Amount, // native value or ERC-20 amount
        Kind, // uint(Kind)
        AmountGt, // 1 if amount > param
        ToIs, // 1 if to == address(param)
        TokenIs // 1 if token == address(param)
    }

    struct Facts {
        Kind kind;
        address to;
        uint256 value;
        address token;
        uint256 amount;
    }

    struct Binding {
        Source source;
        uint256 param;
    }

    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;

    error TxUnsupportedCall(address target, bytes4 selector);

    function decode(address target, uint256 value, bytes memory data) internal pure returns (Facts memory f) {
        if (data.length == 0) return Facts(Kind.Native, target, value, address(0), value);
        bytes4 sel = selectorOf(data);
        if (data.length != 68 || value != 0) revert TxUnsupportedCall(target, sel);
        uint256 a;
        uint256 amt;
        assembly {
            a := mload(add(data, 36))
            amt := mload(add(data, 68))
        }
        if (a >> 160 != 0) revert TxUnsupportedCall(target, sel);
        if (sel == TRANSFER) return Facts(Kind.Erc20Transfer, address(uint160(a)), 0, target, amt);
        if (sel == APPROVE) return Facts(Kind.Erc20Approve, address(uint160(a)), 0, target, amt);
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
            else v[i] = uint160(f.token) == p ? 1 : 0; // TokenIs
        }
    }

    function selectorOf(bytes memory data) internal pure returns (bytes4 sel) {
        if (data.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(data, 32))
        }
    }
}
