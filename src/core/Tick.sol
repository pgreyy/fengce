// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";
import {ITapeOutProcessor} from "./interfaces/ITapeOut.sol";

/// @title Tick
/// @notice State host for stateful (LATCH) TapeOut policies, evaluated with `step()` (TAP-02 section 4).
/// Wallet-agnostic: an account (a Safe, a module, an ERC-7579 hook, any contract) asks Tick to advance
/// its policy before acting, and acts only if Tick returns.
///
/// How state is stored: Tick keeps the circuit's state vector itself, per (account, pinId), packed as
/// TAP-02 bytes (bit i = bit i%8 of byte i/8). The circuit never stores anything.
/// How state is reset: each policy has a period in seconds. The period index is
/// floor(block.timestamp / period) (aligned to the Unix epoch). The first advance in a new period
/// starts from the all-zero state. Example: a "one spend per period" cap.
/// How it advances: `advance` runs step(state, input) and, only if output bit 0 is 1 (allow), stores
/// the new state and increments the nonce (compare-and-swap on `expectedNonce`, so a relayed or
/// replayed call for an old state fails). A deny reverts and changes nothing.
contract Tick {
    struct Policy {
        bool set;
        uint64 period;
        uint64 periodIndex;
        uint64 nonce;
        bytes state;
    }

    PinRegistry public immutable registry;
    uint256 public immutable stepGasCap;

    mapping(address account => mapping(bytes32 pinId => Policy)) internal _policies;
    mapping(address account => mapping(address relayer => bool)) public relayers;

    /// @notice An account configured (or reset) a stateful policy.
    /// @param account The account
    /// @param pinId Pinned stateful circuit
    /// @param period Reset period in seconds
    event TickConfigured(address indexed account, bytes32 indexed pinId, uint64 period);
    /// @notice A policy advanced (the step allowed the action).
    /// @param account The account
    /// @param pinId Pinned circuit
    /// @param periodIndex floor(timestamp / period) of this step
    /// @param nonce Nonce after the step
    /// @param input Packed input bits
    /// @param newState Packed state after the step
    /// @param output Packed output bits
    event TickAdvanced(
        address indexed account, bytes32 indexed pinId, uint64 periodIndex, uint64 nonce, bytes input, bytes newState, bytes output
    );
    /// @notice An account allowed or removed a relayer (for example a Chainlink CRE workflow).
    /// @param account The account
    /// @param relayer Relayer address
    /// @param allowed New value
    event TickRelayerSet(address indexed account, address indexed relayer, bool allowed);

    error TickNotConfigured(address account, bytes32 pinId);
    error TickNotPinned(bytes32 pinId);
    error TickNotStateful(bytes32 pinId);
    error TickBadPeriod();
    error TickStale(uint64 expected, uint64 current);
    error TickBadInput();
    error TickStepFailed(bytes32 pinId);
    error TickBadOutput();
    error TickDenied(address account, bytes32 pinId);
    error TickNotRelayer(address relayer);

    constructor(PinRegistry registry_, uint256 stepGasCap_) {
        registry = registry_;
        stepGasCap = stepGasCap_;
    }

    /// @notice Called by the account. Sets the period and resets the state and nonce.
    function configure(bytes32 pinId, uint64 period) external {
        if (period == 0) revert TickBadPeriod();
        if (!registry.isPinned(pinId)) revert TickNotPinned(pinId);
        if (registry.circuitPin(pinId).nState == 0) revert TickNotStateful(pinId);
        Policy storage p = _policies[msg.sender][pinId];
        p.set = true;
        p.period = period;
        p.periodIndex = uint64(block.timestamp / period);
        p.nonce = 0;
        delete p.state;
        emit TickConfigured(msg.sender, pinId, period);
    }

    function setRelayer(address relayer, bool allowed) external {
        relayers[msg.sender][relayer] = allowed;
        emit TickRelayerSet(msg.sender, relayer, allowed);
    }

    /// @notice Advances the caller's policy. Reverts TickDenied if the circuit denies.
    function advance(bytes32 pinId, bytes calldata input, uint64 expectedNonce) external returns (bytes memory) {
        return _advance(msg.sender, pinId, input, expectedNonce);
    }

    /// @notice Same, for an account by one of its relayers.
    function advanceFor(address account, bytes32 pinId, bytes calldata input, uint64 expectedNonce)
        external
        returns (bytes memory)
    {
        if (!relayers[account][msg.sender]) revert TickNotRelayer(msg.sender);
        return _advance(account, pinId, input, expectedNonce);
    }

    function _advance(address account, bytes32 pinId, bytes calldata input, uint64 expectedNonce)
        private
        returns (bytes memory out)
    {
        Policy storage p = _policies[account][pinId];
        if (!p.set) revert TickNotConfigured(account, pinId);
        if (!registry.isPinned(pinId)) revert TickNotPinned(pinId);
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);

        uint64 idx = uint64(block.timestamp / p.period);
        bytes memory state = p.state;
        if (idx != p.periodIndex) state = ""; // new period: start from the zero state
        if (state.length == 0) state = new bytes((uint256(c.nState) + 7) / 8);
        if (expectedNonce != p.nonce) revert TickStale(expectedNonce, p.nonce);
        if (!_exact(input, c.nIn)) revert TickBadInput();

        (bool ok, bytes memory ret) =
            c.processor.staticcall{gas: stepGasCap}(abi.encodeCall(ITapeOutProcessor.step, (c.circuitId, state, input)));
        if (!ok || ret.length < 128) revert TickStepFailed(pinId);
        bytes memory newState;
        (newState, out) = abi.decode(ret, (bytes, bytes));
        if (!_exact(newState, c.nState) || !_exact(out, c.nOut)) revert TickBadOutput();
        if (uint8(out[0]) & 1 != 1) revert TickDenied(account, pinId);

        p.periodIndex = idx;
        p.state = newState;
        p.nonce += 1;
        emit TickAdvanced(account, pinId, idx, p.nonce, input, newState, out);
    }

    function _exact(bytes memory b, uint32 nBits) private pure returns (bool) {
        uint256 len = (uint256(nBits) + 7) / 8;
        if (b.length != len) return false;
        return nBits % 8 == 0 || uint8(b[len - 1]) >> (nBits % 8) == 0;
    }

    /// @notice The stored policy. `state` is the packed state as of `periodIndex`; if the current period
    /// differs, the next advance starts from zero.
    function policyOf(address account, bytes32 pinId)
        external
        view
        returns (bool set, uint64 period, uint64 periodIndex, uint64 nonce, bytes memory state)
    {
        Policy storage p = _policies[account][pinId];
        return (p.set, p.period, p.periodIndex, p.nonce, p.state);
    }
}
