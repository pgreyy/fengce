// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";
import {Schema} from "./Schema.sol";
import {TxFacts} from "./TxFacts.sol";
import {ITapeOutProcessor} from "./interfaces/ITapeOut.sol";

/// @title Tick
/// @notice State host for stateful (LATCH) TapeOut policies, evaluated with `step()` (TAP-02 section 4).
/// Wallet-agnostic: an account (or the guard acting for it) asks Tick to advance a policy group before
/// acting, and acts only if Tick returns.
///
/// Groups: state belongs to a policy group, not to one account, so several Safes or agents can share
/// one budget. A group fixes the stateful circuit (pinId), the reset period, and the schema + bindings
/// that turn transaction facts into the circuit's input. Its admin (the creator) adds and removes
/// member accounts. Only members can advance, directly or through a relayer they authorised (for
/// example their FengceGuard, or a Chainlink CRE workflow).
///
/// How state is stored: Tick keeps the circuit's state vector itself, per group, packed as TAP-02
/// bytes (bit i = bit i%8 of byte i/8). The circuit never stores anything.
/// How state is reset: the period index is floor(block.timestamp / period) (Unix-epoch aligned); the
/// first advance in a new period starts from the all-zero state.
/// How it advances: step(state, input) runs; only if output bit 0 is 1 (allow) the new state is stored
/// and the nonce incremented. A deny reverts and changes nothing. `expectedNonce` gives
/// compare-and-swap for relayed calls (type(uint64).max skips the check).
/// Rollback: the first advance of a group in a transaction snapshots its previous state; the same
/// caller can `rollback` in that transaction (FengceGuard does this when the Safe transaction fails).
contract Tick {
    struct Group {
        address admin;
        bytes32 pinId;
        uint64 period;
        uint64 periodIndex;
        uint64 nonce;
        bytes state;
        bytes32 netlistHash;
        uint32 nIn;
        Schema.Field[] fields;
        TxFacts.Binding[] bindings;
    }

    struct Snapshot {
        uint64 periodIndex;
        uint64 nonce;
        bytes state;
    }

    uint64 public constant ANY_NONCE = type(uint64).max;

    PinRegistry public immutable registry;
    uint256 public immutable stepGasCap;

    mapping(bytes32 groupId => Group) internal _groups;
    mapping(bytes32 groupId => mapping(address account => bool)) public isMember;
    mapping(address account => mapping(address relayer => bool)) public relayers;
    mapping(bytes32 groupId => Snapshot) internal _snapshots;

    /// @notice A policy group was created.
    /// @param groupId keccak256(admin, salt)
    /// @param admin Creator, who manages members
    /// @param pinId Pinned stateful circuit
    /// @param period Reset period in seconds
    event TickGroupCreated(bytes32 indexed groupId, address indexed admin, bytes32 indexed pinId, uint64 period);
    /// @notice Group membership changed.
    /// @param groupId Group
    /// @param account Member account
    /// @param member New value
    event TickMemberSet(bytes32 indexed groupId, address indexed account, bool member);
    /// @notice A group advanced (the step allowed the action).
    /// @param groupId Group
    /// @param account Member the step was for
    /// @param periodIndex floor(timestamp / period) of this step
    /// @param nonce Nonce after the step
    /// @param input Packed input bits
    /// @param newState Packed state after the step
    /// @param output Packed output bits
    event TickAdvanced(
        bytes32 indexed groupId, address indexed account, uint64 periodIndex, uint64 nonce, bytes input, bytes newState, bytes output
    );
    /// @notice A group's advance in this transaction was undone.
    /// @param groupId Group
    /// @param by Caller that rolled back
    event TickRolledBack(bytes32 indexed groupId, address indexed by);
    /// @notice An account allowed or removed a relayer.
    /// @param account The account
    /// @param relayer Relayer address (for example its FengceGuard)
    /// @param allowed New value
    event TickRelayerSet(address indexed account, address indexed relayer, bool allowed);

    error TickGroupExists(bytes32 groupId);
    error TickNoGroup(bytes32 groupId);
    error TickNotAdmin(address caller);
    error TickNotMember(bytes32 groupId, address account);
    error TickNotPinned(bytes32 pinId);
    error TickNotStateful(bytes32 pinId);
    error TickBadPeriod();
    error TickBadSchema();
    error TickStale(uint64 expected, uint64 current);
    error TickBadInput();
    error TickStepFailed(bytes32 pinId);
    error TickBadOutput();
    error TickDenied(bytes32 groupId, address account);
    error TickNotRelayer(address relayer);
    error TickNothingToRollBack(bytes32 groupId);

    constructor(PinRegistry registry_, uint256 stepGasCap_) {
        registry = registry_;
        stepGasCap = stepGasCap_;
    }

    // ------------------------------------------------------------------ groups

    function groupIdOf(address admin, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(admin, salt));
    }

    /// @notice Creates a group. `layout` must be the schema the pin committed to; `bindings` map
    /// transaction facts onto its non-flag fields (used by advanceFacts).
    function createGroup(
        bytes32 salt,
        bytes32 pinId,
        uint64 period,
        Schema.Layout calldata layout,
        TxFacts.Binding[] calldata bindings
    ) external returns (bytes32 groupId) {
        groupId = groupIdOf(msg.sender, salt);
        if (_groups[groupId].admin != address(0)) revert TickGroupExists(groupId);
        if (period == 0) revert TickBadPeriod();
        if (!registry.isPinned(pinId)) revert TickNotPinned(pinId);
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);
        if (c.nState == 0) revert TickNotStateful(pinId);
        Schema.Layout memory l = layout;
        if (Schema.hash(l) != c.schemaHash || l.nIn != c.nIn || l.netlistHash != c.netlistHash) revert TickBadSchema();
        Schema.validate(l);
        uint256 needed;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (bindings.length != needed) revert TickBadSchema();

        Group storage g = _groups[groupId];
        g.admin = msg.sender;
        g.pinId = pinId;
        g.period = period;
        g.periodIndex = uint64(block.timestamp / period);
        g.netlistHash = c.netlistHash;
        g.nIn = c.nIn;
        for (uint256 i; i < l.fields.length; i++) {
            g.fields.push(l.fields[i]);
        }
        for (uint256 i; i < bindings.length; i++) {
            g.bindings.push(bindings[i]);
        }
        emit TickGroupCreated(groupId, msg.sender, pinId, period);
    }

    function setMember(bytes32 groupId, address account, bool member) external {
        if (_groups[groupId].admin != msg.sender) revert TickNotAdmin(msg.sender);
        isMember[groupId][account] = member;
        emit TickMemberSet(groupId, account, member);
    }

    function setRelayer(address relayer, bool allowed) external {
        relayers[msg.sender][relayer] = allowed;
        emit TickRelayerSet(msg.sender, relayer, allowed);
    }

    // ------------------------------------------------------------------ advancing

    /// @notice Advances a group with raw input bytes, for the caller (a member).
    function advance(bytes32 groupId, bytes calldata input, uint64 expectedNonce) external returns (bytes memory) {
        return _advance(groupId, msg.sender, input, expectedNonce);
    }

    /// @notice Same, for a member by one of its relayers.
    function advanceFor(address account, bytes32 groupId, bytes calldata input, uint64 expectedNonce)
        external
        returns (bytes memory)
    {
        if (!relayers[account][msg.sender]) revert TickNotRelayer(msg.sender);
        return _advance(groupId, account, input, expectedNonce);
    }

    /// @notice Advances a group from transaction facts, encoded with the group's schema and bindings.
    /// Called by the member itself or by one of its relayers (FengceGuard). No nonce check.
    function advanceFacts(address account, bytes32 groupId, TxFacts.Facts calldata f) external returns (bytes memory) {
        if (msg.sender != account && !relayers[account][msg.sender]) revert TickNotRelayer(msg.sender);
        Group storage g = _groups[groupId];
        Schema.Layout memory l = Schema.Layout(g.netlistHash, g.nIn, g.fields);
        bytes memory input = Schema.encode(l, TxFacts.values(f, g.bindings));
        return _advance(groupId, account, input, ANY_NONCE);
    }

    /// @notice Undoes this transaction's advances of `groupId` made by the caller.
    function rollback(bytes32 groupId) external {
        bytes32 key = _snapKey(groupId);
        address by;
        assembly {
            by := tload(key)
        }
        if (by != msg.sender) revert TickNothingToRollBack(groupId);
        Group storage g = _groups[groupId];
        Snapshot storage s = _snapshots[groupId];
        g.periodIndex = s.periodIndex;
        g.nonce = s.nonce;
        g.state = s.state;
        assembly {
            tstore(key, 0)
        }
        emit TickRolledBack(groupId, msg.sender);
    }

    function _advance(bytes32 groupId, address account, bytes memory input, uint64 expectedNonce)
        private
        returns (bytes memory out)
    {
        Group storage g = _groups[groupId];
        if (g.admin == address(0)) revert TickNoGroup(groupId);
        if (!isMember[groupId][account]) revert TickNotMember(groupId, account);
        if (!registry.isPinned(g.pinId)) revert TickNotPinned(g.pinId);
        PinRegistry.CircuitPin memory c = registry.circuitPin(g.pinId);
        if (expectedNonce != ANY_NONCE && expectedNonce != g.nonce) revert TickStale(expectedNonce, g.nonce);
        if (!_exact(input, c.nIn)) revert TickBadInput();

        uint64 idx = uint64(block.timestamp / g.period);
        bytes memory state = idx == g.periodIndex ? g.state : bytes("");
        if (state.length == 0) state = new bytes((uint256(c.nState) + 7) / 8);

        (bool ok, bytes memory ret) =
            c.processor.staticcall{gas: stepGasCap}(abi.encodeCall(ITapeOutProcessor.step, (c.circuitId, state, input)));
        if (!ok || ret.length < 128) revert TickStepFailed(g.pinId);
        bytes memory newState;
        (newState, out) = abi.decode(ret, (bytes, bytes));
        if (!_exact(newState, c.nState) || !_exact(out, c.nOut)) revert TickBadOutput();
        if (uint8(out[0]) & 1 != 1) revert TickDenied(groupId, account);

        _snapshotOnce(groupId, g);
        g.periodIndex = idx;
        g.state = newState;
        g.nonce += 1;
        emit TickAdvanced(groupId, account, idx, g.nonce, input, newState, out);
    }

    function _snapshotOnce(bytes32 groupId, Group storage g) private {
        bytes32 key = _snapKey(groupId);
        address by;
        assembly {
            by := tload(key)
        }
        if (by != address(0)) return; // already snapshotted in this transaction
        _snapshots[groupId] = Snapshot(g.periodIndex, g.nonce, g.state);
        address advancer = msg.sender;
        assembly {
            tstore(key, advancer)
        }
    }

    function _snapKey(bytes32 groupId) private pure returns (bytes32) {
        return keccak256(abi.encode("fengce.tick.snapshot", groupId));
    }

    function _exact(bytes memory b, uint32 nBits) private pure returns (bool) {
        uint256 len = (uint256(nBits) + 7) / 8;
        if (b.length != len) return false;
        return nBits % 8 == 0 || uint8(b[len - 1]) >> (nBits % 8) == 0;
    }

    // ------------------------------------------------------------------ views

    /// @notice A group's stored state. `state` is as of `periodIndex`; if the current period differs,
    /// the next advance starts from zero.
    function groupOf(bytes32 groupId)
        external
        view
        returns (address admin, bytes32 pinId, uint64 period, uint64 periodIndex, uint64 nonce, bytes memory state)
    {
        Group storage g = _groups[groupId];
        return (g.admin, g.pinId, g.period, g.periodIndex, g.nonce, g.state);
    }
}
