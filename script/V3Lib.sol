// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {Tick} from "../src/core/Tick.sol";
import {FengceRulesV3} from "../src/safe/FengceRulesV3.sol";
import {FengceGuardV3} from "../src/safe/FengceGuardV3.sol";
import {OkunLib} from "./OkunLib.sol";

/// @notice FengceGuardV3 install, built the same way for the fork tests (test/fork/GuardV3.t.sol) and the mainnet
/// script (script/M2Demo.s.sol). One owner transaction (MultiSendCallOnly) on a Safe with no guard yet:
/// max per buy (NAND circuit #2), the swap decoders, the Tilt-shield circuits on Tick (counter #7 for buys in the window,
/// the Tilt-shield latch for the pause), the v3 rules, optionally an agent with a daily cap, then both guards.
library V3Lib {
    bytes32 internal constant TILT_COUNT_SALT = keccak256("fengce.tilt-count.v1");
    bytes32 internal constant TILT_LATCH_SALT = keccak256("fengce.tilt-latch.v1");
    uint64 internal constant TILT_WINDOW = 30 minutes; // Tick period of the count group (UTC half hours)
    uint64 internal constant LATCH_PERIOD = 100 * 365 days; // never resets by the clock; only `clear` resets it
    uint256 internal constant EVAL_GAS_CAP = 2_000_000; // same as release v2

    struct Install {
        address guard;
        address safe;
        uint256 maxPerBuy; // USDT0 base units
        bytes32 maxBuyPin;
        // Tilt-shield (tiltAfter 0 = off)
        uint256 tiltAfter; // buys within the window that trip it (2-16); the count group runs counter pin N = tiltAfter - 1
        bytes32 counterPin; // pin of counter circuit #7 for N = tiltAfter - 1
        bytes32 counterNetlistHash;
        bytes32 latchPin;
        bytes32 latchNetlistHash;
        uint32 tiltCooldown;
        uint16 tiltMultX10;
        // other rules
        bool quietOn;
        uint8 quietStart;
        uint8 quietEnd;
        uint32 holdSeconds;
        address partner;
        // agent (executor 0 = none)
        address executor;
        address agent;
        uint256 agentCapPerDay;
    }

    function latchLayout(bytes32 netlistHash) internal pure returns (Schema.Layout memory l) {
        l.netlistHash = netlistHash;
        l.nIn = 3;
        l.fields = new Schema.Field[](3);
        l.fields[0] = Schema.Field(Schema.Kind.Bool, 0, 1, 0); // isBuy
        l.fields[1] = Schema.Field(Schema.Kind.Bool, 1, 1, 0); // trip
        l.fields[2] = Schema.Field(Schema.Kind.Bool, 2, 1, 0); // clear
    }

    function countGroup(address safe) internal pure returns (bytes32) {
        return keccak256(abi.encode(safe, TILT_COUNT_SALT));
    }

    function latchGroup(address safe) internal pure returns (bytes32) {
        return keccak256(abi.encode(safe, TILT_LATCH_SALT));
    }

    function rules(Install memory p) internal pure returns (FengceRulesV3.Rules memory r) {
        r.quietOn = p.quietOn;
        r.quietStart = p.quietStart;
        r.quietEnd = p.quietEnd;
        r.holdSeconds = p.holdSeconds;
        r.tiltOn = p.tiltAfter != 0;
        r.tiltCountGroup = p.tiltAfter != 0 ? countGroup(p.safe) : bytes32(0);
        r.tiltLatchGroup = p.tiltAfter != 0 ? latchGroup(p.safe) : bytes32(0);
        r.tiltMultX10 = p.tiltMultX10;
        r.tiltCooldown = p.tiltCooldown;
        r.quoteToken = OkunLib.USDT0;
        r.partner = p.partner;
    }

    function _call(address to, bytes memory data) private pure returns (bytes memory) {
        return abi.encodePacked(uint8(0), to, uint256(0), data.length, data);
    }

    function configureInput(uint256 maxPerBuy, bytes32 maxBuyPin) internal pure returns (FengceRulesV3.ConfigInput memory c) {
        c.pinId = maxBuyPin;
        c.layout = OkunLib.maxBuyLayout();
        c.bindings = new TxFacts.Binding[](2);
        c.bindings[0] = TxFacts.Binding(TxFacts.Source.AmountGt, maxPerBuy);
        c.bindings[1] = TxFacts.Binding(TxFacts.Source.TokenIs, uint256(uint160(OkunLib.USDT0)));
        c.recoveryDelay = OkunLib.RECOVERY_DELAY;
        c.recoveryWindow = OkunLib.RECOVERY_WINDOW;
        c.adminDelay = OkunLib.ADMIN_DELAY;
        c.preflightTokens = new address[](1);
        c.preflightTokens[0] = OkunLib.USDT0;
        c.preflightSpenders = new address[](1);
        c.preflightSpenders[0] = OkunLib.ROUTER;
    }

    /// MultiSendCallOnly payload of the v3 install.
    function installMultiSend(Install memory p) internal pure returns (bytes memory) {
        address G = p.guard;
        bytes memory b = _call(G, abi.encodeCall(FengceGuardV3.configure, (configureInput(p.maxPerBuy, p.maxBuyPin))));
        bytes4[4] memory sels = [bytes4(0x04e45aaf), 0xb858183f, 0x5023b4df, 0x09b81346];
        for (uint256 i; i < 4; i++) {
            b = abi.encodePacked(b, _call(G, abi.encodeCall(FengceGuardV3.setDecoder, (OkunLib.ROUTER, sels[i], OkunLib.V3_DECODER))));
        }
        if (p.tiltAfter != 0) {
            TxFacts.Binding[] memory one = new TxFacts.Binding[](1);
            one[0] = TxFacts.Binding(TxFacts.Source.Kind, 0);
            TxFacts.Binding[] memory three = new TxFacts.Binding[](3);
            for (uint256 i; i < 3; i++) {
                three[i] = TxFacts.Binding(TxFacts.Source.Kind, 0); // unused: the guard drives the latch with raw bits
            }
            b = abi.encodePacked(
                b,
                _call(OkunLib.TICK, abi.encodeCall(Tick.setRelayer, (G, true))),
                _call(OkunLib.TICK, abi.encodeCall(Tick.createGroup, (TILT_COUNT_SALT, p.counterPin, TILT_WINDOW, OkunLib.counterLayout(p.counterNetlistHash, p.tiltAfter - 1), one))),
                _call(OkunLib.TICK, abi.encodeCall(Tick.setMember, (countGroup(p.safe), p.safe, true))),
                _call(OkunLib.TICK, abi.encodeCall(Tick.createGroup, (TILT_LATCH_SALT, p.latchPin, LATCH_PERIOD, latchLayout(p.latchNetlistHash), three))),
                _call(OkunLib.TICK, abi.encodeCall(Tick.setMember, (latchGroup(p.safe), p.safe, true)))
            );
        }
        b = abi.encodePacked(b, _call(G, abi.encodeCall(FengceGuardV3.setRules, (rules(p)))));
        if (p.executor != address(0)) {
            b = abi.encodePacked(
                b,
                _call(p.safe, abi.encodeWithSignature("enableModule(address)", p.executor)),
                _call(p.safe, abi.encodeWithSignature("setModuleGuard(address)", G)),
                _call(p.executor, abi.encodeWithSignature("addAgent(address,uint64)", p.agent, uint64(0))),
                _call(G, abi.encodeCall(FengceGuardV3.setAgentCap, (p.executor, p.agent, true, p.agentCapPerDay)))
            );
        }
        b = abi.encodePacked(
            b,
            _call(p.safe, abi.encodeWithSignature("setGuard(address)", G)),
            _call(p.safe, abi.encodeWithSignature("setModuleGuard(address)", G))
        );
        return abi.encodeWithSignature("multiSend(bytes)", b);
    }
}
