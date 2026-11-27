// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TxFacts} from "../core/TxFacts.sol";
import {Schema} from "../core/Schema.sol";
import {ApprovalScan} from "../core/ApprovalScan.sol";
import {MultiSendDecoder} from "./MultiSendDecoder.sol";
import {Tick} from "../core/Tick.sol";
import {PinRegistry} from "../core/PinRegistry.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {FengceLimits} from "./FengceLimits.sol";

/// @title FengceRulesV3
/// @notice Facts and bookkeeping for the v3 rules of FengceGuardV3, as a linked library (it runs in the guard's storage
/// through DELEGATECALL, which keeps the guard under the contract size limit).
///
/// The rules decide on TapeOut circuits; this library only turns numbers into the one-bit facts those circuits read,
/// and keeps the numbers it needs:
/// - Quiet hours: bit "this swap is inside the UTC hour window" -> NAND circuit #2 (allow = NOT(swap AND inside)).
/// - Hold lock: bit "this swap sells a token bought less than holdSeconds ago" -> NAND circuit #2.
/// - Agent cap: bit "this agent spend goes over the agent's daily cap" -> NAND circuit #2.
/// - Tilt-shield: bits "buy", "3x the usual size" and "cooldown over" -> the counter circuit #7 (buys in the window)
///   and the Tilt-shield latch circuit (pause state), both run by Tick.
/// The comparisons stay here because circuit inputs are bits fixed per pin: a window, a duration or a cap chosen by the
/// user would need one taped-out pin per value.
///
/// State writes go through a transient journal so the guard can undo them when the Safe transaction fails without
/// reverting (module transactions, or owner transactions with safeTxGas set).
library FengceRulesV3 {
    // ------------------------------------------------------------------ reason codes (FengceGuardV3.FengceRefused)
    uint8 internal constant CIRCUIT = 1; // the Safe's pinned TapeOut policy (for example max per buy)
    uint8 internal constant TRADES_PER_HOUR = 2; // the Tick counter circuit
    uint8 internal constant QUIET_HOURS = 3;
    uint8 internal constant HOLD_LOCK = 4;
    uint8 internal constant TILT_SHIELD = 5;
    uint8 internal constant AGENT_CAP = 6;
    uint8 internal constant OTHER = 7;

    // ------------------------------------------------------------------ alarm codes (Alarm event)
    uint8 internal constant ALARM_TILT_TRIPPED = 1;
    uint8 internal constant ALARM_LOOSEN_SCHEDULED = 2;
    uint8 internal constant ALARM_PARTNER_APPROVED = 3;
    uint8 internal constant ALARM_TIGHTENED = 4;

    struct Rules {
        bool quietOn;
        uint8 quietStart; // UTC hour 0-23
        uint8 quietEnd; // UTC hour 0-23, exclusive; start == end means all day
        uint32 holdSeconds; // 0 = off
        bool tiltOn;
        bytes32 tiltCountGroup; // Tick group of counter circuit #7 (period 1800 s): the pin's N is buys before the trip
        bytes32 tiltLatchGroup; // Tick group of the Tilt-shield latch circuit (pause state)
        uint16 tiltMultX10; // 30 = 3x the usual buy; 0 = size check off
        uint32 tiltCooldown; // seconds buys stay paused
        address quoteToken; // what a buy pays (USDT0); required for Tilt-shield, hold lock and agent caps
        address partner; // optional: can approve a scheduled change early; loosening then waits 7 days by default
    }

    struct AgentCap {
        bool on;
        uint256 perDay; // quote token base units
    }

    /// keccak256("fengce.rules.v3") - 1, ERC-7201 style storage location in the guard
    bytes32 internal constant LOCATION = 0x9a57f217486e173034fca5d4a86893cc651eefd65d7136fdc890c40c96dcea92;
    /// transient journal: count at JOURNAL, entries (slot, old value) after it
    bytes32 internal constant JOURNAL = keccak256("fengce.rules.v3.journal");

    struct Store {
        mapping(address safe => Rules) rules;
        mapping(bytes32 key => AgentCap) caps; // key = keccak256(safe, module, agent)
        mapping(bytes32 key => Word) spent; // key = keccak256(safe, module, agent, day)
        mapping(bytes32 key => Word) lastBuy; // key = keccak256(safe, token)
        mapping(address safe => Word) trippedAt; // when the Tilt-shield latch was last set (0 = not paused)
        mapping(address safe => Word) usual; // uint128 usual buy | uint32 count << 128
        mapping(bytes32 pin => uint256) counterN; // pins of counter circuit #7: N (buys or trades per period)
    }

    struct Word {
        uint256 v;
    }

    /// @notice Tilt-shield paused buying for `safe` until `ref` (a timestamp, as bytes32), or another alarm.
    event Alarm(address indexed safe, uint8 indexed code, bytes32 ref);
    /// @notice Same as FengceGuard: configuration went ahead although `module` is enabled (override set).
    event ExistingModuleAccepted(address indexed safe, address module);

    error FengceModulesEnabled(uint256 count);
    error FengceModulesUnreadable(address safe);
    error FengceBadTick();
    error FengceBadConfig();

    /// keccak256 of the Tilt-shield latch netlist (circuits/tilt-latch.json)
    bytes32 internal constant TILT_LATCH_NETLIST_HASH = 0x8d0c6d168add46910f31e030659e69f00ba4bafebf7ae6c13f9a9ae79941c442;
    bytes32 internal constant STEPS = keccak256("fengce.guard.v3.tilt-steps");
    address internal constant SENTINEL_MODULES = address(0x1);

    function _s() private pure returns (Store storage s) {
        bytes32 loc = LOCATION;
        assembly {
            s.slot := loc
        }
    }

    function rulesOf(address safe) internal view returns (Rules storage) {
        return _s().rules[safe];
    }

    function capKey(address safe, address module, address agent) internal pure returns (bytes32) {
        return keccak256(abi.encode(safe, module, agent));
    }

    // ------------------------------------------------------------------ checks

    function _inQuiet(Rules storage r, uint256 ts) private view returns (bool) {
        // hour of day (UTC), not randomness
        // slither-disable-next-line weak-prng
        uint256 h = (ts / 1 hours) % 24;
        uint256 a = r.quietStart;
        uint256 b = r.quietEnd;
        if (a == b) return true;
        return a < b ? (h >= a && h < b) : (h >= a || h < b);
    }

    function _isBuy(Rules storage r, TxFacts.Facts memory f) private view returns (bool) {
        return f.kind == TxFacts.Kind.Swap && r.quoteToken != address(0) && f.token == r.quoteToken;
    }

    /// @notice One-bit facts for the circuits. `a` bits say the rule applies to this call; `b` bits are the condition.
    struct Bits {
        bool quietA; // swap and quiet hours on
        bool quietB; // inside the window now
        bool holdA; // swap that sells a token, hold lock on
        bool holdB; // that token was bought less than holdSeconds ago
        bool capA; // agent spend in the quote token, cap on
        bool capB; // over the agent's daily cap
        bool buy; // swap paying the quote token, Tilt-shield on
        bool big; // at least tiltMultX10 / 10 times the usual buy (after 3 buys of history)
        bool cooled; // the cooldown since the last trip is over
    }

    function facts(address safe, TxFacts.Facts memory f, bytes32 agentKey) public view returns (Bits memory b) {
        Store storage s = _s();
        Rules storage r = s.rules[safe];
        bool swap = f.kind == TxFacts.Kind.Swap;
        bool isBuy = _isBuy(r, f);
        if (swap && r.quietOn) {
            b.quietA = true;
            b.quietB = _inQuiet(r, block.timestamp);
        }
        if (swap && r.holdSeconds != 0 && !isBuy) {
            b.holdA = true;
            uint256 at = s.lastBuy[keccak256(abi.encode(safe, f.token))].v;
            b.holdB = at != 0 && block.timestamp < at + r.holdSeconds;
        }
        if (agentKey != 0 && s.caps[agentKey].on && r.quoteToken != address(0) && f.token == r.quoteToken) {
            b.capA = true;
            uint256 used = s.spent[keccak256(abi.encode(agentKey, block.timestamp / 1 days))].v;
            b.capB = used + f.amount > s.caps[agentKey].perDay;
        }
        if (isBuy && r.tiltOn) {
            b.buy = true;
            uint256 u = s.usual[safe].v;
            b.big = r.tiltMultX10 != 0 && (u >> 128) >= 3 && f.amount * 10 >= (u & type(uint128).max) * r.tiltMultX10;
            uint256 t = s.trippedAt[safe].v;
            b.cooled = t != 0 && block.timestamp >= t + r.tiltCooldown;
        }
    }

    /// @notice Records an allowed call: per-token buy times, the usual buy size and agent spending. Journaled.
    function record(address safe, TxFacts.Facts memory f, bytes32 agentKey) public {
        Store storage s = _s();
        Rules storage r = s.rules[safe];
        if (_isBuy(r, f)) {
            if (f.tokenOut != address(0)) _jset(s.lastBuy[keccak256(abi.encode(safe, f.tokenOut))], block.timestamp);
            Word storage uw = s.usual[safe];
            uint256 u = uw.v & type(uint128).max;
            uint256 cnt = uw.v >> 128;
            uint256 nu = cnt == 0 ? f.amount : (u * 3 + f.amount) / 4;
            if (nu > type(uint128).max) nu = type(uint128).max;
            _jset(uw, nu | ((cnt + 1 > type(uint32).max ? cnt : cnt + 1) << 128));
        }
        if (agentKey != 0 && s.caps[agentKey].on && r.quoteToken != address(0) && f.token == r.quoteToken) {
            if (f.kind == TxFacts.Kind.Transfer || f.kind == TxFacts.Kind.Swap) {
                Word storage sp = s.spent[keccak256(abi.encode(agentKey, block.timestamp / 1 days))];
                _jset(sp, sp.v + f.amount);
            }
        }
    }

    /// @notice The guard set (now != 0) or cleared (0) the Tilt-shield latch. Journaled.
    function setTripped(address safe, uint256 at) public {
        _jset(_s().trippedAt[safe], at);
        if (at != 0) emit Alarm(safe, ALARM_TILT_TRIPPED, bytes32(at + _s().rules[safe].tiltCooldown));
    }

    /// @notice When the latch was set (0 = not paused), the usual buy size and buys recorded so far.
    function tiltState(address safe) internal view returns (uint256 trippedAt, uint256 usualBuy, uint256 buysSeen) {
        Store storage s = _s();
        trippedAt = s.trippedAt[safe].v;
        usualBuy = s.usual[safe].v & type(uint128).max;
        buysSeen = s.usual[safe].v >> 128;
    }

    function lastBuyOf(address safe, address token) internal view returns (uint256) {
        return _s().lastBuy[keccak256(abi.encode(safe, token))].v;
    }

    function agentCapOf(bytes32 key) internal view returns (bool on, uint256 perDay, uint256 spentToday) {
        Store storage s = _s();
        AgentCap storage c = s.caps[key];
        return (c.on, c.perDay, s.spent[keccak256(abi.encode(key, block.timestamp / 1 days))].v);
    }

    // ------------------------------------------------------------------ setting rules

    function setRules(address safe, Rules memory r) internal {
        _s().rules[safe] = r;
    }

    function setCap(bytes32 key, bool on, uint256 perDay) internal {
        _s().caps[key] = AgentCap(on, perDay);
    }

    /// @notice True if `n` is at least as strict as the current rules in every respect, so it can apply at once.
    /// Any change of partner or quote token counts as loosening (a partner can approve changes early).
    function rulesTighten(address safe, Rules memory n) public view returns (bool) {
        Rules storage o = _s().rules[safe];
        if (n.partner != o.partner || (n.quoteToken != o.quoteToken && o.quoteToken != address(0))) return false;
        if (o.quietOn) {
            if (!n.quietOn) return false;
            for (uint256 h; h < 24; h++) {
                if (_inQuietMem(o.quietStart, o.quietEnd, h) && !_inQuietMem(n.quietStart, n.quietEnd, h)) return false;
            }
        }
        if (n.holdSeconds < o.holdSeconds) return false;
        if (o.tiltOn) {
            // the count group may change only to one with a lower N (checked by the guard through the pin)
            if (!n.tiltOn || n.tiltLatchGroup != o.tiltLatchGroup || n.tiltCooldown < o.tiltCooldown) return false;
            if (o.tiltMultX10 != 0 && (n.tiltMultX10 == 0 || n.tiltMultX10 > o.tiltMultX10)) return false;
        }
        return true;
    }

    function _inQuietMem(uint8 a, uint8 b, uint256 h) private pure returns (bool) {
        if (a == b) return true;
        return a < b ? (h >= a && h < b) : (h >= a || h < b);
    }

    /// @notice Adding a cap or lowering one tightens; raising or removing one loosens.
    function capTightens(bytes32 key, bool on, uint256 perDay) public view returns (bool) {
        AgentCap storage o = _s().caps[key];
        if (!o.on) return true;
        return on && perDay <= o.perDay;
    }

    /// @notice A new policy configuration tightens when it keeps the pin, the schema and every binding, except that
    /// AmountGt thresholds may go down, and keeps or lengthens every delay.
    function configTightens(
        bytes32 curPin,
        uint64[3] memory curDelays,
        TxFacts.Binding[] memory cur,
        bytes32 newPin,
        uint64[3] memory newDelays,
        TxFacts.Binding[] memory next
    ) public pure returns (bool) {
        if (newPin != curPin || cur.length != next.length) return false;
        for (uint256 i; i < 3; i++) {
            if (newDelays[i] < curDelays[i]) return false;
        }
        for (uint256 i; i < cur.length; i++) {
            if (cur[i].source != next[i].source) return false;
            if (cur[i].source == TxFacts.Source.AmountGt) {
                if (next[i].param > cur[i].param) return false;
            } else if (cur[i].param != next[i].param) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------ Tilt-shield on circuits (Tick)

    function setCounterN(bytes32 pin, uint256 n) internal {
        _s().counterN[pin] = n;
    }

    function counterN(bytes32 pin) internal view returns (uint256) {
        return _s().counterN[pin];
    }

    /// @notice Checks a Safe's rules before they are stored (called by the Safe through the guard).
    function validateRules(Tick tick, PinRegistry registry, Rules memory r, address guard) public view {
        if (r.quietStart > 23 || r.quietEnd > 23 || r.partner == msg.sender || r.partner == guard) revert FengceBadConfig();
        if (!r.tiltOn) return;
        if (r.quoteToken == address(0) || r.tiltCooldown == 0) revert FengceBadConfig();
        if (!tick.relayers(msg.sender, guard)) revert FengceBadTick();
        (, bytes32 cPin,,,,) = tick.groupOf(r.tiltCountGroup);
        (, bytes32 lPin,,,,) = tick.groupOf(r.tiltLatchGroup);
        if (_s().counterN[cPin] == 0 || registry.circuitPin(lPin).netlistHash != TILT_LATCH_NETLIST_HASH) revert FengceBadTick();
        if (!tick.isMember(r.tiltCountGroup, msg.sender) || !tick.isMember(r.tiltLatchGroup, msg.sender)) revert FengceBadTick();
    }

    /// @notice A new count group tightens when it runs a counter pin with a lower or equal N.
    function countTightens(Tick tick, bytes32 oldGroup, bytes32 newGroup) public view returns (bool) {
        if (oldGroup == newGroup) return true;
        (, bytes32 oldPin,,,,) = tick.groupOf(oldGroup);
        (, bytes32 newPin,,,,) = tick.groupOf(newGroup);
        uint256 a = _s().counterN[oldPin];
        uint256 z = _s().counterN[newPin];
        return a != 0 && z != 0 && z <= a;
    }

    /// @notice Runs Tilt-shield for a buy on its circuits. 0 = allowed, else TILT_SHIELD. The latch (input isBuy, plus
    /// clear once the cooldown is over) refuses a buy while paused; counter circuit #7 refuses past N buys in the window,
    /// which trips the shield, as does a buy of 3x the usual size; the tripping buy itself goes through.
    function tilt(Tick tick, address safe, TxFacts.Facts memory f, Bits memory b) public returns (uint8) {
        Rules storage r = _s().rules[safe];
        if (!_step(tick, safe, r.tiltLatchGroup, b.cooled ? 5 : 1)) return TILT_SHIELD;
        if (b.cooled) setTripped(safe, 0);
        bool trip = b.big;
        try tick.advanceFacts(safe, r.tiltCountGroup, f) {
            _remember(r.tiltCountGroup);
        } catch {
            trip = true;
        }
        if (trip) {
            if (!_step(tick, safe, r.tiltLatchGroup, 2)) return TILT_SHIELD;
            setTripped(safe, block.timestamp);
        }
        return 0;
    }

    /// @notice The partner clears the latch (input clear). Returns false if the latch circuit refused.
    function clearTilt(Tick tick, address safe) public returns (bool) {
        if (!_step(tick, safe, _s().rules[safe].tiltLatchGroup, 4)) return false;
        setTripped(safe, 0);
        return true;
    }

    function _step(Tick tick, address safe, bytes32 group, uint8 input) private returns (bool) {
        try tick.advanceFor(safe, group, abi.encodePacked(input), type(uint64).max) {
            _remember(group);
            return true;
        } catch {
            return false;
        }
    }

    function _remember(bytes32 group) private {
        bytes32 k = STEPS;
        assembly {
            let n := tload(k)
            tstore(add(k, add(1, n)), group)
            tstore(k, add(n, 1))
        }
    }

    /// @notice End of a Safe transaction: keep (success) or undo every journaled write and Tick step of the v3 rules.
    function finish(Tick tick, bool success) public {
        bytes32 k = STEPS;
        uint256 n;
        assembly {
            n := tload(k)
        }
        if (!success) {
            for (uint256 i; i < n; i++) {
                bytes32 g;
                assembly {
                    g := tload(add(k, add(1, i)))
                }
                // a group stepped twice is restored once; the second call has nothing left to roll back
                try tick.rollback(g) {} catch {}
            }
            rollback();
        } else {
            clear();
        }
        assembly {
            tstore(k, 0)
        }
    }

    /// @notice FengceGuard's enabled-module check on first configuration (msg.sender is the Safe).
    function checkModules(bool accept) public {
        address start = SENTINEL_MODULES;
        uint256 count;
        for (uint256 page; page < 64; page++) {
            address[] memory mods;
            address next;
            try ISafe(payable(msg.sender)).getModulesPaginated(start, FengceLimits.MODULE_PAGE) returns (address[] memory m, address nx) {
                (mods, next) = (m, nx);
            } catch {
                revert FengceModulesUnreadable(msg.sender);
            }
            count += mods.length;
            if (mods.length != 0 && !accept) revert FengceModulesEnabled(count);
            for (uint256 i; i < mods.length; i++) {
                emit ExistingModuleAccepted(msg.sender, mods[i]);
            }
            if (next == SENTINEL_MODULES || next == address(0) || mods.length == 0) return;
            start = next;
        }
        revert FengceModulesUnreadable(msg.sender);
    }

    // ------------------------------------------------------------------ heavy helpers kept out of the guard's bytecode

    /// @notice FengceGuardV3.configure input (same ABI as FengceGuard v2).
    struct ConfigInput {
        bytes32 pinId;
        Schema.Layout layout;
        TxFacts.Binding[] bindings;
        uint64 recoveryDelay;
        uint64 recoveryWindow;
        uint64 adminDelay;
        address[] preflightTokens;
        address[] preflightSpenders;
        bool acceptExistingApprovals;
        bool acceptExistingModules;
    }

    function decodeFacts(address account, address target, uint256 value, bytes memory data, bool allowlisted)
        public
        view
        returns (TxFacts.Facts memory)
    {
        return TxFacts.decode(account, target, value, data, allowlisted);
    }

    function decodeBatch(bytes memory data, address safe) public pure returns (MultiSendDecoder.Call[] memory) {
        return MultiSendDecoder.decode(data, safe);
    }

    function encodeInput(Schema.Layout memory l, TxFacts.Facts memory f, TxFacts.Binding[] memory b)
        public
        pure
        returns (bytes memory)
    {
        return Schema.encode(l, TxFacts.values(f, b));
    }

    function checkLayout(Schema.Layout memory l) public pure returns (bytes32) {
        Schema.validate(l);
        return Schema.hash(l);
    }

    function scan(address account, address[] memory tokens, address[] memory spenders)
        public
        view
        returns (ApprovalScan.Finding[] memory)
    {
        return ApprovalScan.scan(account, tokens, spenders);
    }

    /// @notice Decodes a configure() call (without selector) for the tighten check.
    function configTightensData(
        bytes memory args,
        bytes32 curPin,
        uint64[3] memory cur,
        TxFacts.Binding[] memory curB
    ) public pure returns (bool) {
        ConfigInput memory n = abi.decode(args, (ConfigInput));
        uint64[3] memory nxt = [n.recoveryDelay, n.adminDelay, type(uint64).max - n.recoveryWindow];
        return configTightens(curPin, cur, curB, n.pinId, nxt, n.bindings);
    }

    /// @notice Reason code from a dry run's revert data: 0 if it would be allowed, the FengceRefused code, else OTHER.
    function refusalCode(bytes memory err, bytes4 allowedSel, bytes4 refusedSel) public pure returns (uint8) {
        if (err.length < 4) return OTHER;
        bytes4 sel;
        uint256 c;
        assembly {
            sel := mload(add(err, 32))
            c := mload(add(err, 36))
        }
        if (sel == allowedSel) return 0;
        if (sel == refusedSel && err.length >= 36 && c != 0 && c < 256) return uint8(c);
        return OTHER;
    }

    /// @notice Current policy configuration of a Safe, as the tighten check needs it.
    struct Current {
        bytes32 pinId;
        uint64[3] delays; // recoveryDelay, adminDelay, max - recoveryWindow (a longer window is looser)
        TxFacts.Binding[] bindings;
        address tick;
        bytes32 tickGroup;
    }

    bytes4 internal constant SEL_SET_RULES = 0x967f77ff;
    bytes4 internal constant SEL_SET_AGENT_CAP = 0x266e8ad3;
    bytes4 internal constant SEL_CONFIGURE = 0x704f9e63;
    bytes4 internal constant SEL_CONFIGURE_TICK = 0xfa57da0c;

    /// @notice True if a guard configuration call (full calldata) only tightens, so it can apply without the timelock.
    function tightens(address safe, bytes memory data, Current memory c, Tick tiltTick) public view returns (bool) {
        if (data.length < 4) return false;
        bytes4 sel = bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24);
        bytes memory args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; i++) {
            args[i] = data[i + 4];
        }
        if (sel == SEL_SET_RULES) {
            Rules memory n = abi.decode(args, (Rules));
            if (!rulesTighten(safe, n)) return false;
            Rules storage o = _s().rules[safe];
            return !o.tiltOn || countTightens(tiltTick, o.tiltCountGroup, n.tiltCountGroup);
        }
        if (sel == SEL_SET_AGENT_CAP) {
            (address module, address agent, bool on, uint256 perDay) = abi.decode(args, (address, address, bool, uint256));
            return capTightens(capKey(safe, module, agent), on, perDay);
        }
        if (sel == SEL_CONFIGURE) return configTightensData(args, c.pinId, c.delays, c.bindings);
        if (sel == SEL_CONFIGURE_TICK) {
            (address tick, bytes32 group) = abi.decode(args, (address, bytes32));
            if (tick == address(0)) return false;
            if (c.tick == address(0)) return true; // adding a trades-per-hour limit
            if (tick != c.tick) return false;
            return countTightens(Tick(tick), c.tickGroup, group);
        }
        return false;
    }

    // ------------------------------------------------------------------ journal

    function _jset(Word storage w, uint256 v) private {
        bytes32 j = JOURNAL;
        assembly {
            let slot := w.slot
            let n := tload(j)
            tstore(add(j, add(1, mul(n, 2))), slot)
            tstore(add(j, add(2, mul(n, 2))), sload(slot))
            tstore(j, add(n, 1))
            sstore(slot, v)
        }
    }

    /// @notice Undoes every journaled write of this transaction (newest first).
    function rollback() public {
        bytes32 j = JOURNAL;
        assembly {
            let n := tload(j)
            for {} gt(n, 0) {} {
                n := sub(n, 1)
                sstore(tload(add(j, add(1, mul(n, 2)))), tload(add(j, add(2, mul(n, 2)))))
            }
            tstore(j, 0)
        }
    }

    /// @notice Keeps this transaction's writes.
    function clear() public {
        bytes32 j = JOURNAL;
        assembly {
            tstore(j, 0)
        }
    }
}
