// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Verdict
/// @notice Parimutuel YES/NO prediction markets in one token (USDT0 on X Layer), settled by a pinned
/// TapeOut circuit evaluated on values read from X Layer contracts. No admin, no upgrade, no fee.
///
/// Lifecycle of a market:
///   createMarket  question, pinned circuit with its input layout, inputs, deadline, settle window.
///                 Records each input source's code hash and the pin's REF closure hash.
///   bet           YES or NO, until the deadline (exclusive).
///   checkpoint    once, by anyone, inside [deadline, deadline + settleWindow]: reads every input with a
///                 staticcall and stores the values and the block number. Reverts if a source's code
///                 hash changed, so a changed source can never be checkpointed.
///   settle        by anyone, after the checkpoint: evaluates the pinned circuit on the stored values
///                 (output bit 0 = 1 is YES). The pin must still hold (PinRegistry.isPinned re-checks
///                 every processor in the closure and the circuit implementation).
///   claim         winners take the whole pool pro rata to their stake on the winning side.
///   refund        every stake back in full when the market is VOID: no checkpoint inside the window,
///                 a source's code hash changed before a checkpoint, the pin closure changed, the
///                 circuit evaluation (or encoding) failed, or one side has no stake.
///
/// The checkpoint fixes the observed values to the state of one block inside the settle window, chosen
/// by whoever calls it first. That caller can pick any block in the window; the window is the
/// manipulation window (docs/VERDICT.md).
contract Verdict is PolicyEngine {
    enum Side {
        Yes,
        No
    }

    enum State {
        Open,
        Checkpointed,
        Yes,
        No,
        Void
    }

    enum VoidReason {
        None,
        NoCheckpoint,
        SourceChanged,
        ClosureChanged,
        EvalFailed,
        OneSided
    }

    /// @notice How an input's value is obtained.
    enum Decode {
        Word, // staticcall(source, callData); value = 32-byte return word number `arg` (0 = first)
        Constant // no call; value = `arg` (source must be address(0), callData empty)
    }

    /// @notice One input value, in the order of the layout's non-Flag fields.
    struct Input {
        address source;
        bytes callData;
        Decode decode;
        uint256 arg;
    }

    struct Market {
        address creator;
        bytes32 pinId;
        bytes32 refClosureHash; // recorded at creation from PinRegistry
        bytes32 netlistHash; // the pinned circuit's netlist hash, recorded at creation
        uint32 nIn; // the pinned circuit's input count, recorded at creation
        uint64 deadline;
        uint64 settleWindow;
        uint64 checkpointBlock;
        uint64 checkpointTime;
        State state;
        VoidReason voidReason;
        uint256[2] totals; // [YES, NO]
        string question;
    }

    uint256 public constant SOURCE_GAS = 200_000;
    uint64 public constant MIN_SETTLE_WINDOW = 5 minutes;
    uint64 public constant MAX_SETTLE_WINDOW = 1 days;
    uint256 public constant MAX_INPUTS = 16;

    IERC20Min public immutable token;

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => Schema.Field[]) internal _fields;
    mapping(uint256 => Input[]) internal _inputs;
    mapping(uint256 => bytes32[]) internal _codehashes;
    mapping(uint256 => uint256[]) internal _values;
    mapping(uint256 => mapping(address => uint256[2])) internal _stakes;
    mapping(uint256 => mapping(address => bool)) public paid;

    event MarketCreated(
        uint256 indexed id,
        address indexed creator,
        bytes32 indexed pinId,
        bytes32 refClosureHash,
        string question,
        uint64 deadline,
        uint64 settleWindow
    );
    /// @notice Emitted with MarketCreated: the inputs and each source's code hash recorded at creation.
    event MarketInputs(uint256 indexed id, Input[] inputs, bytes32[] sourceCodehashes);
    event BetPlaced(uint256 indexed id, address indexed who, Side side, uint256 amount);
    event Checkpointed(uint256 indexed id, address indexed caller, uint256 blockNumber, uint256[] values);
    event Settled(uint256 indexed id, State outcome, bytes input, bytes output);
    event Voided(uint256 indexed id, VoidReason reason);
    event Claimed(uint256 indexed id, address indexed who, uint256 amount);
    event Refunded(uint256 indexed id, address indexed who, uint256 amount);

    error VerdictNotPinned(bytes32 pinId);
    error VerdictSchemaMismatch();
    error VerdictBadInputs();
    error VerdictBadTimes();
    error VerdictUnknownMarket(uint256 id);
    error VerdictClosed();
    error VerdictZeroAmount();
    error VerdictWrongState(State state);
    error VerdictOutsideWindow();
    error VerdictSourceChanged(uint256 input);
    error VerdictSourceRead(uint256 input);
    error VerdictNotEnoughGas();
    error VerdictNothingToPay();
    error VerdictTransferFailed();

    constructor(PinRegistry registry_, IERC20Min token_, uint256 evalGasCap_) PolicyEngine(registry_, evalGasCap_) {
        token = token_;
    }

    // ------------------------------------------------------------------ create

    /// @notice Everything a market is created with; nothing can change afterwards.
    struct NewMarket {
        string question;
        bytes32 pinId; // pinned rule circuit (PinRegistry)
        Schema.Layout layout; // must be the layout the pin committed to (schemaHash)
        Input[] inputs; // one per non-Flag field of the layout, in field order
        uint64 deadline; // last moment to bet (exclusive); the checkpoint window opens here
        uint64 settleWindow; // checkpoint allowed in [deadline, deadline + settleWindow]
    }

    function createMarket(NewMarket calldata p) external returns (uint256 id) {
        PinRegistry.CircuitPin memory pin = _checkRule(p.pinId, p.layout, p.inputs.length);
        if (p.deadline <= block.timestamp) revert VerdictBadTimes();
        if (p.settleWindow < MIN_SETTLE_WINDOW || p.settleWindow > MAX_SETTLE_WINDOW) revert VerdictBadTimes();

        id = marketCount++;
        Market storage m = _markets[id];
        m.creator = msg.sender;
        m.pinId = p.pinId;
        m.refClosureHash = pin.refClosureHash;
        m.netlistHash = pin.netlistHash;
        m.nIn = pin.nIn;
        m.deadline = p.deadline;
        m.settleWindow = p.settleWindow;
        m.question = p.question;
        Schema.Field[] calldata f = p.layout.fields;
        for (uint256 i; i < f.length; i++) {
            _fields[id].push(f[i]);
        }
        _storeInputs(id, p.inputs);
        emit MarketCreated(id, msg.sender, p.pinId, m.refClosureHash, p.question, p.deadline, p.settleWindow);
        emit MarketInputs(id, p.inputs, _codehashes[id]);
    }

    function _checkRule(bytes32 pinId, Schema.Layout calldata layout, uint256 nInputs)
        private
        view
        returns (PinRegistry.CircuitPin memory pin)
    {
        if (registry.kindOf(pinId) != PinRegistry.Kind.Circuit || !registry.isPinned(pinId)) {
            revert VerdictNotPinned(pinId);
        }
        pin = registry.circuitPin(pinId);
        Schema.Layout memory l = layout;
        if (Schema.hash(l) != pin.schemaHash || l.nIn != pin.nIn || l.netlistHash != pin.netlistHash) {
            revert VerdictSchemaMismatch();
        }
        Schema.validate(l);
        uint256 needed = 0;
        for (uint256 i; i < l.fields.length; i++) {
            if (l.fields[i].kind != Schema.Kind.Flag) needed++;
        }
        if (nInputs != needed || nInputs == 0 || nInputs > MAX_INPUTS) revert VerdictBadInputs();
    }

    function _storeInputs(uint256 id, Input[] calldata inputs) private {
        for (uint256 i; i < inputs.length; i++) {
            Input calldata x = inputs[i];
            if (x.decode == Decode.Constant) {
                if (x.source != address(0) || x.callData.length != 0) revert VerdictBadInputs();
                _codehashes[id].push(bytes32(0));
            } else {
                if (x.source.code.length == 0 || x.arg >= 64) revert VerdictBadInputs();
                _codehashes[id].push(x.source.codehash);
            }
            _inputs[id].push(x);
        }
    }

    // ------------------------------------------------------------------ bet

    function bet(uint256 id, Side side, uint256 amount) external {
        Market storage m = _market(id);
        if (m.state != State.Open || block.timestamp >= m.deadline) revert VerdictClosed();
        if (amount == 0) revert VerdictZeroAmount();
        m.totals[uint8(side)] += amount;
        _stakes[id][msg.sender][uint8(side)] += amount;
        emit BetPlaced(id, msg.sender, side, amount);
        _pull(msg.sender, amount);
    }

    // ------------------------------------------------------------------ checkpoint

    function checkpoint(uint256 id) external {
        Market storage m = _market(id);
        if (m.state != State.Open) revert VerdictWrongState(m.state);
        if (block.timestamp < m.deadline || block.timestamp > uint256(m.deadline) + m.settleWindow) {
            revert VerdictOutsideWindow();
        }
        uint256[] memory v = readInputs(id);
        _values[id] = v;
        m.checkpointBlock = uint64(block.number);
        m.checkpointTime = uint64(block.timestamp);
        m.state = State.Checkpointed;
        emit Checkpointed(id, msg.sender, block.number, v);
    }

    /// @notice Reads every input exactly as `checkpoint` does, at the current block. Reverts if a source's
    /// code hash changed since creation or a read fails.
    function readInputs(uint256 id) public view returns (uint256[] memory v) {
        _market(id);
        Input[] storage xs = _inputs[id];
        v = new uint256[](xs.length);
        for (uint256 i; i < xs.length; i++) {
            Input storage x = xs[i];
            if (x.decode == Decode.Constant) {
                v[i] = x.arg;
                continue;
            }
            if (x.source.codehash != _codehashes[id][i]) revert VerdictSourceChanged(i);
            (bool ok, uint256 w) = _readWord(x.source, x.callData, x.arg);
            if (!ok) revert VerdictSourceRead(i);
            v[i] = w;
        }
    }

    // ------------------------------------------------------------------ settle

    /// @notice Gas `settle` needs so a caller cannot starve the evaluation into VOID.
    function settleMinGas() public view returns (uint256) {
        return evalGasCap + evalGasCap / 63 + 150_000;
    }

    function settle(uint256 id) external {
        Market storage m = _market(id);
        if (m.state != State.Checkpointed) revert VerdictWrongState(m.state);
        if (m.totals[0] == 0 || m.totals[1] == 0) return _void(id, m, VoidReason.OneSided);
        if (!registry.isPinned(m.pinId) || registry.circuitPin(m.pinId).refClosureHash != m.refClosureHash) {
            return _void(id, m, VoidReason.ClosureChanged);
        }
        if (gasleft() < settleMinGas()) revert VerdictNotEnoughGas();
        try this.evaluateStored(id) returns (bytes memory input, bytes memory output) {
            m.state = (uint8(output[0]) & 1) == 1 ? State.Yes : State.No;
            emit Settled(id, m.state, input, output);
        } catch {
            _void(id, m, VoidReason.EvalFailed);
        }
    }

    /// @notice The evaluation `settle` runs: the stored checkpoint values encoded with the market's
    /// layout, evaluated on the pinned circuit (fails closed). Anyone can call it to re-run.
    function evaluateStored(uint256 id) external view returns (bytes memory input, bytes memory output) {
        Market storage m = _market(id);
        if (m.checkpointBlock == 0) revert VerdictWrongState(m.state);
        input = encode(id, _values[id]);
        output = _evaluate(m.pinId, input);
    }

    /// @notice Encodes values with the market's layout, as `settle` does.
    function encode(uint256 id, uint256[] memory values) public view returns (bytes memory) {
        Market storage m = _market(id);
        return Schema.encode(Schema.Layout(m.netlistHash, m.nIn, _fields[id]), values);
    }

    // ------------------------------------------------------------------ pay out

    function claim(uint256 id) external {
        Market storage m = _market(id);
        if (m.state != State.Yes && m.state != State.No) revert VerdictWrongState(m.state);
        uint256 amount = claimable(id, msg.sender);
        if (amount == 0) revert VerdictNothingToPay();
        paid[id][msg.sender] = true;
        emit Claimed(id, msg.sender, amount);
        _push(msg.sender, amount);
    }

    /// @notice Full refund of a VOID market. Also turns an OPEN market VOID when no checkpoint was made
    /// inside the window, or when a source's code hash changed before the checkpoint.
    function refund(uint256 id) external {
        Market storage m = _market(id);
        if (m.state == State.Open) {
            VoidReason r = stuckReason(id);
            if (r != VoidReason.None) _void(id, m, r);
        }
        if (m.state != State.Void) revert VerdictWrongState(m.state);
        uint256 amount = claimable(id, msg.sender);
        if (amount == 0) revert VerdictNothingToPay();
        paid[id][msg.sender] = true;
        emit Refunded(id, msg.sender, amount);
        _push(msg.sender, amount);
    }

    /// @notice Why an OPEN market can no longer settle (None if it still can).
    function stuckReason(uint256 id) public view returns (VoidReason) {
        Market storage m = _market(id);
        if (m.state != State.Open) return VoidReason.None;
        if (block.timestamp > uint256(m.deadline) + m.settleWindow) return VoidReason.NoCheckpoint;
        Input[] storage xs = _inputs[id];
        for (uint256 i; i < xs.length; i++) {
            if (xs[i].decode == Decode.Word && xs[i].source.codehash != _codehashes[id][i]) {
                return VoidReason.SourceChanged;
            }
        }
        return VoidReason.None;
    }

    /// @notice What `who` can take out now: winnings after YES/NO, the full stake after VOID.
    function claimable(uint256 id, address who) public view returns (uint256) {
        Market storage m = _market(id);
        if (paid[id][who]) return 0;
        uint256[2] storage s = _stakes[id][who];
        if (m.state == State.Void) return s[0] + s[1];
        if (m.state != State.Yes && m.state != State.No) return 0;
        uint8 w = m.state == State.Yes ? 0 : 1;
        if (s[w] == 0) return 0;
        return s[w] * (m.totals[0] + m.totals[1]) / m.totals[w];
    }

    // ------------------------------------------------------------------ views

    function market(uint256 id) external view returns (Market memory) {
        return _market(id);
    }

    function marketData(uint256 id)
        external
        view
        returns (Schema.Field[] memory fields, Input[] memory inputs, bytes32[] memory sourceCodehashes, uint256[] memory values)
    {
        _market(id);
        return (_fields[id], _inputs[id], _codehashes[id], _values[id]);
    }

    function stakeOf(uint256 id, address who) external view returns (uint256 yes, uint256 no) {
        return (_stakes[id][who][0], _stakes[id][who][1]);
    }

    // ------------------------------------------------------------------ internals

    function _market(uint256 id) internal view returns (Market storage m) {
        if (id >= marketCount) revert VerdictUnknownMarket(id);
        return _markets[id];
    }

    function _void(uint256 id, Market storage m, VoidReason r) private {
        m.state = State.Void;
        m.voidReason = r;
        emit Voided(id, r);
    }

    /// @dev Staticcall with a gas cap that copies only the requested return word (no return-data bomb).
    function _readWord(address target, bytes memory data, uint256 word) private view returns (bool ok, uint256 w) {
        uint256 g = SOURCE_GAS;
        assembly {
            ok := staticcall(g, target, add(data, 32), mload(data), 0, 0)
            let off := mul(word, 32)
            if lt(returndatasize(), add(off, 32)) { ok := 0 }
            if ok {
                returndatacopy(0, off, 32)
                w := mload(0)
            }
        }
    }

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeCall(IERC20Min.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert VerdictTransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20Min.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert VerdictTransferFailed();
    }
}
