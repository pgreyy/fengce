// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {Tick} from "../src/core/Tick.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";

/// @notice Fengce limits: what a Safe installs with one signature, built the same way as the app
/// (app/src/fengce/engine.ts). test/fork/LimitsInstall.t.sol checks both produce the same bytes.
library LimitsLib {
    // Release v2 contracts (deployments/xlayer-196-v2.json)
    address internal constant GUARD = 0x9D2A482fFA86fa3193F85c451A44576E2f1C8E6e;
    address internal constant TICK = 0xFEb6FD15F8724bfC69a119C0448f480a7D7e5370;
    address internal constant PIN_REGISTRY = 0xD905dde3A09a9777B98013AD196E3b3F988e3715;
    address internal constant V3_DECODER = 0x47FDb3C6E91661562243f97Df2f4b0B8EfFAA479;
    // Safe and Uniswap on X Layer
    address internal constant MSCO = 0xA83c336B20401Af773B6219BA5027174338D1836;
    address internal constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address internal constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address internal constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    // Circuits
    address internal constant MAX_BUY_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e; // circuit #2: NAND(in0, in1)
    uint256 internal constant MAX_BUY_ID = 2;
    address internal constant COUNTER_CPU = 0x7335a50819d44402e3D5E00239bBB80A13E7308F; // processor #180

    uint64 internal constant ADMIN_DELAY = 1 days; // any change to the limits
    uint64 internal constant RECOVERY_DELAY = 2 days; // removing the guard, every owner signs
    uint64 internal constant RECOVERY_WINDOW = 2 days;
    uint64 internal constant TRADE_PERIOD = 1 hours;
    bytes32 internal constant TICK_SALT = keccak256("okun.trades-per-hour.v1");

    /// keccak256 of circuit #2's netlist: NAND(2,3), NOT, NOT.
    bytes32 internal constant MAX_BUY_NETLIST_HASH = keccak256(hex"000000020000030000000400000400000005000005");

    function maxBuyLayout() internal pure returns (Schema.Layout memory l) {
        l.netlistHash = MAX_BUY_NETLIST_HASH;
        l.nIn = 2;
        l.fields = new Schema.Field[](2);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // amount over the cap
        l.fields[1] = Schema.Field(Schema.Kind.Bool, 1, 1, 0); // paying USDT0
    }

    /// N swaps per period, fixed by four Flag fields (bits 3..6).
    function counterLayout(bytes32 netlistHash, uint256 n) internal pure returns (Schema.Layout memory l) {
        require(n >= 1 && n <= 15, "trades per hour 1-15");
        l.netlistHash = netlistHash;
        l.nIn = 7;
        l.fields = new Schema.Field[](5);
        l.fields[0] = Schema.Field(Schema.Kind.Uint, 0, 3, 0); // TxFacts.Kind of the call
        for (uint32 b; b < 4; b++) {
            l.fields[1 + b] = Schema.Field(Schema.Kind.Flag, 3 + b, 1, (n >> b) & 1);
        }
    }

    function configureInput(uint256 maxPerBuy, bytes32 maxBuyPin) internal pure returns (FengceGuard.ConfigInput memory c) {
        c.pinId = maxBuyPin;
        c.layout = maxBuyLayout();
        c.bindings = new TxFacts.Binding[](2);
        c.bindings[0] = TxFacts.Binding(TxFacts.Source.AmountGt, maxPerBuy);
        c.bindings[1] = TxFacts.Binding(TxFacts.Source.TokenIs, uint256(uint160(USDT0)));
        c.recoveryDelay = RECOVERY_DELAY;
        c.recoveryWindow = RECOVERY_WINDOW;
        c.adminDelay = ADMIN_DELAY;
        c.preflightTokens = new address[](1);
        c.preflightTokens[0] = USDT0;
        c.preflightSpenders = new address[](1);
        c.preflightSpenders[0] = ROUTER;
    }

    function tickGroupId(address safe) internal pure returns (bytes32) {
        return keccak256(abi.encode(safe, TICK_SALT));
    }

    function _call(address to, bytes memory data) private pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, uint256(0), data.length, data);
    }

    /// MultiSendCallOnly payload of the install, in the app's order. tradesPerHour 0 = no counter.
    function installMultiSend(
        address safe,
        uint256 maxPerBuy,
        uint256 tradesPerHour,
        bytes32 maxBuyPin,
        bytes32 counterPin,
        bytes32 counterNetlistHash
    ) internal pure returns (bytes memory) {
        bytes memory p = _call(GUARD, abi.encodeCall(FengceGuard.configure, (configureInput(maxPerBuy, maxBuyPin))));
        bytes4[4] memory sels = [bytes4(0x04e45aaf), 0xb858183f, 0x5023b4df, 0x09b81346];
        for (uint256 i; i < 4; i++) {
            p = abi.encodePacked(p, _call(GUARD, abi.encodeCall(FengceGuard.setDecoder, (ROUTER, sels[i], V3_DECODER))));
        }
        if (tradesPerHour > 0) {
            TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
            b[0] = TxFacts.Binding(TxFacts.Source.Kind, 0);
            bytes32 group = tickGroupId(safe);
            p = abi.encodePacked(
                p,
                _call(TICK, abi.encodeCall(Tick.createGroup, (TICK_SALT, counterPin, TRADE_PERIOD, counterLayout(counterNetlistHash, tradesPerHour), b))),
                _call(TICK, abi.encodeCall(Tick.setMember, (group, safe, true))),
                _call(TICK, abi.encodeCall(Tick.setRelayer, (GUARD, true))),
                _call(GUARD, abi.encodeCall(FengceGuard.configureTick, (TICK, group)))
            );
        }
        p = abi.encodePacked(
            p,
            _call(safe, abi.encodeWithSignature("setGuard(address)", GUARD)),
            _call(safe, abi.encodeWithSignature("setModuleGuard(address)", GUARD))
        );
        return abi.encodeWithSignature("multiSend(bytes)", p);
    }

    /// Approve exactly `amountIn`, then exactInputSingle on SwapRouter02 back to the Safe (fee tier 0.05%).
    function swapMultiSend(address safe, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory approve = abi.encodeWithSignature("approve(address,uint256)", ROUTER, amountIn);
        bytes memory swap = abi.encodeWithSelector(
            bytes4(0x04e45aaf), tokenIn, tokenOut, uint24(500), safe, amountIn, minOut, uint160(0)
        );
        return abi.encodeWithSignature("multiSend(bytes)", abi.encodePacked(_call(tokenIn, approve), _call(ROUTER, swap)));
    }

    /// Pre-validated signature for a 1-of-1 Safe: valid because the owner is msg.sender of execTransaction.
    function ownerSignature(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(uint256(uint160(owner)), uint256(0), uint8(1));
    }
}
