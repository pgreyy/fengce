// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MultiSendDecoder
/// @notice Strict decoder for `multiSend(bytes)` calldata as executed by Safe's MultiSendCallOnly.
/// Packed records: operation(1) to(20) value(32) dataLength(32) data(dataLength).
/// The decoder accepts only encodings on which it and MultiSendCallOnly must agree:
/// the bytes offset must be 0x20, every record must be a call (operation 0), and the records must
/// fill the payload exactly. An inner `to` of zero means the Safe itself, as in MultiSendCallOnly.
library MultiSendDecoder {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    bytes4 internal constant MULTI_SEND = 0x8d80ff0a; // multiSend(bytes)

    error MultiSendMalformed();
    error MultiSendDelegateCall();

    function decode(bytes memory data, address safe) internal pure returns (Call[] memory calls) {
        if (data.length < 68) revert MultiSendMalformed();
        bytes4 sel;
        uint256 offset;
        uint256 len;
        assembly {
            sel := mload(add(data, 32))
            offset := mload(add(data, 36))
            len := mload(add(data, 68))
        }
        if (sel != MULTI_SEND || offset != 0x20 || len > data.length - 68) revert MultiSendMalformed();

        // Pass 1: validate and count, before allocating.
        uint256 n;
        uint256 i;
        while (i < len) {
            if (len - i < 85) revert MultiSendMalformed();
            (uint8 op,,, uint256 dl) = _head(data, i);
            if (op != 0) revert MultiSendDelegateCall();
            if (dl > len - i - 85) revert MultiSendMalformed();
            i += 85 + dl;
            n++;
        }

        // Pass 2: fill.
        calls = new Call[](n);
        i = 0;
        for (uint256 k; k < n; k++) {
            (, address to, uint256 value, uint256 dl) = _head(data, i);
            bytes memory inner = new bytes(dl);
            for (uint256 b; b < dl; b++) {
                inner[b] = data[68 + i + 85 + b];
            }
            calls[k] = Call(to == address(0) ? safe : to, value, inner);
            i += 85 + dl;
        }
    }

    /// @dev Reads the 85-byte record header at payload offset `i` (payload starts at data byte 68).
    function _head(bytes memory data, uint256 i)
        private
        pure
        returns (uint8 op, address to, uint256 value, uint256 dataLength)
    {
        assembly {
            let p := add(add(data, 100), i) // 32 (length word) + 68
            op := shr(248, mload(p))
            to := shr(96, mload(add(p, 1)))
            value := mload(add(p, 21))
            dataLength := mload(add(p, 53))
        }
    }
}
