// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "../core/PinRegistry.sol";
import {PolicyEngine} from "../core/PolicyEngine.sol";
import {Schema} from "../core/Schema.sol";
import {VerdictTypes} from "./VerdictTypes.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title Market
/// @notice One parimutuel YES/NO market in a single token (USDT0), settled by a pinned TapeOut
/// circuit on a native X Layer value. Everything is fixed at creation; there are no setters.
///
/// Lifecycle: bet before `cutoff`; settle inside the settle window [T, T + settleWindow]; claim;
/// after the claim period, leftover (rounding dust and unclaimed winnings) goes to the reserve.
/// Outcomes: circuit output bit 0 = 1 -> YES, 0 -> NO. INVALID (full refunds, no fee) when the pool
/// is one-sided, nobody settled inside the window, the data source is unpinned or unreadable, or the
/// rule cannot be evaluated (rule pin broken, encoding rejected, eval failing). A market can never
/// get stuck: after the window, `settle` or `claim` marks it INVALID.
///
/// The observed value is read at call time: it is the on-chain state in the block of the settle
/// transaction, not the state at T. Whoever settles can pick any block inside the settle window, so
/// the manipulation window equals the settle window.
///
/// The settler gets a reward taken out of the fee (min(rewardBps of the pool, fee)), only on YES/NO
/// outcomes. Winners always receive the pool minus the fee; INVALID refunds carry no fee and no reward.
contract Market is PolicyEngine {
    enum Side {
        Yes,
        No
    }

    enum State {
        Open,
        Yes,
        No,
        Invalid
    }

    enum InvalidReason {
        None,
        OneSided,
        Late,
        SourceUnpinned,
        SourceReadFailed,
        RuleFailed
    }

    struct Terms {
        IERC20Min token;
        uint16 feeBps; // on the total pool, YES/NO outcomes only
        uint16 rewardBps; // settler reward, paid out of the fee
        address feeRecipient;
        address reserve;
        uint64 claimPeriod;
    }

    uint256 public constant SOURCE_GAS = 200_000;

    address public immutable factory;
    IERC20Min public immutable token;
    uint16 public immutable feeBps;
    uint16 public immutable rewardBps;
    address public immutable feeRecipient;
    address public immutable reserve;
    uint64 public immutable cutoff;
    uint64 public immutable observationTime;
    uint64 public immutable settleWindow;
    uint64 public immutable claimPeriod;
    bytes32 public immutable pinId;
    bytes32 public immutable dataPlanHash;
    bytes32 public immutable netlistHash;
    uint32 public immutable nIn;
    address public immutable source;
    bytes32 public immutable sourcePinId;

    bytes public sourceCall;
    Schema.Field[] internal _fields;
    VerdictTypes.Binding[] internal _bindings;

    uint256[2] public totals;
    mapping(address => uint256[2]) internal _stakes;
    mapping(address => bool) public claimed;

    State public state;
    InvalidReason public invalidReason;
    uint256 public settledAt;
    uint256 public observed;
    uint256 public distributable;

    event Bet(address indexed who, Side side, uint256 amount);
    event Settled(
        State outcome,
        InvalidReason reason,
        uint256 observed,
        bytes input,
        bytes output,
        uint256 fee,
        uint256 distributable,
        address settler,
        uint256 reward
    );
    event Claimed(address indexed who, uint256 amount);
    event Swept(uint256 amount);

    error MarketClosed();
    error MarketZeroAmount();
    error MarketTooEarly(uint256 observationTime);
    error MarketAlreadySettled();
    error MarketNotSettled();
    error MarketNothingToClaim();
    error MarketClaimOpen();
    error MarketNotEnoughGas();
    error MarketTransferFailed();
    error MarketSourceRead();

    constructor(
        PinRegistry registry_,
        uint256 evalGasCap_,
        VerdictTypes.MarketSpec memory spec,
        bytes32 dataPlanHash_,
        Terms memory terms
    ) PolicyEngine(registry_, evalGasCap_) {
        factory = msg.sender;
        token = terms.token;
        feeBps = terms.feeBps;
        rewardBps = terms.rewardBps;
        feeRecipient = terms.feeRecipient;
        reserve = terms.reserve;
        settleWindow = spec.settleWindow;
        claimPeriod = terms.claimPeriod;
        cutoff = spec.cutoff;
        observationTime = spec.observationTime;
        pinId = spec.pinId;
        dataPlanHash = dataPlanHash_;
        netlistHash = spec.layout.netlistHash;
        nIn = spec.layout.nIn;
        source = spec.plan.source;
        sourcePinId = spec.plan.sourcePinId;
        sourceCall = spec.plan.callData;
        for (uint256 i; i < spec.layout.fields.length; i++) {
            _fields.push(spec.layout.fields[i]);
        }
        for (uint256 i; i < spec.bindings.length; i++) {
            _bindings.push(spec.bindings[i]);
        }
    }

    // ------------------------------------------------------------------ betting

    function bet(Side side, uint256 amount) external {
        if (state != State.Open || block.timestamp >= cutoff) revert MarketClosed();
        if (amount == 0) revert MarketZeroAmount();
        totals[uint8(side)] += amount;
        _stakes[msg.sender][uint8(side)] += amount;
        emit Bet(msg.sender, side, amount);
        _pull(msg.sender, amount);
    }

    function stakeOf(address who) external view returns (uint256 yes, uint256 no) {
        return (_stakes[who][0], _stakes[who][1]);
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Gas the settle call needs so a caller cannot starve the rule into INVALID.
    function settleMinGas() public view returns (uint256) {
        return evalGasCap + evalGasCap / 63 + SOURCE_GAS + 400_000;
    }

    function settle() external {
        if (state != State.Open) revert MarketAlreadySettled();
        if (block.timestamp < observationTime) revert MarketTooEarly(observationTime);
        if (_late()) {
            _invalidate(InvalidReason.Late);
            return;
        }
        if (gasleft() < settleMinGas()) revert MarketNotEnoughGas();

        InvalidReason r;
        bytes memory input;
        bytes memory output;
        uint256 value;
        if (totals[0] == 0 || totals[1] == 0) {
            r = InvalidReason.OneSided;
        } else if (sourcePinId != bytes32(0) && !registry.isPinned(sourcePinId)) {
            r = InvalidReason.SourceUnpinned;
        } else {
            try this.readSource() returns (uint256 v) {
                value = v;
                try this.evaluateRule(v) returns (bytes memory i, bytes memory o) {
                    input = i;
                    output = o;
                } catch {
                    r = InvalidReason.RuleFailed;
                }
            } catch {
                r = InvalidReason.SourceReadFailed;
            }
        }
        if (r != InvalidReason.None) {
            _invalidate(r);
            return;
        }

        settledAt = block.timestamp;
        observed = value;
        state = (uint8(output[0]) & 1) == 1 ? State.Yes : State.No;
        uint256 total = totals[0] + totals[1];
        uint256 fee = total * feeBps / 10_000;
        uint256 reward = total * rewardBps / 10_000;
        if (reward > fee) reward = fee;
        distributable = total - fee;
        emit Settled(state, r, value, input, output, fee, distributable, msg.sender, reward);
        if (reward != 0) _push(msg.sender, reward);
        if (fee != reward) _push(feeRecipient, fee - reward);
    }

    function _late() private view returns (bool) {
        return block.timestamp > uint256(observationTime) + settleWindow;
    }

    function _invalidate(InvalidReason r) private {
        settledAt = block.timestamp;
        state = State.Invalid;
        invalidReason = r;
        emit Settled(State.Invalid, r, 0, "", "", 0, 0, msg.sender, 0);
    }

    /// @notice The data plan read, exactly as settlement does it. Anyone can call it to re-run.
    function readSource() external view returns (uint256 v) {
        (bool ok, bytes memory ret) = source.staticcall{gas: SOURCE_GAS}(sourceCall);
        if (!ok || ret.length != 32) revert MarketSourceRead();
        return abi.decode(ret, (uint256));
    }

    /// @notice The rule, exactly as settlement runs it: encode with the frozen schema and evaluate
    /// the pinned circuit (fails closed). Anyone can call it to re-run with any value.
    function evaluateRule(uint256 value) external view returns (bytes memory input, bytes memory output) {
        Schema.Layout memory l = Schema.Layout(netlistHash, nIn, _fields);
        input = Schema.encode(l, VerdictTypes.values(_bindings, value));
        output = _evaluate(pinId, input);
    }

    // ------------------------------------------------------------------ claims

    function claimable(address who) public view returns (uint256) {
        if (state == State.Open || claimed[who]) return 0;
        uint256[2] storage s = _stakes[who];
        if (state == State.Invalid) return s[0] + s[1]; // full refund, no fee
        uint8 w = state == State.Yes ? 0 : 1;
        return s[w] * distributable / totals[w];
    }

    function claim() external {
        if (state == State.Open && block.timestamp >= observationTime && _late()) _invalidate(InvalidReason.Late);
        if (state == State.Open) revert MarketNotSettled();
        uint256 amount = claimable(msg.sender);
        if (amount == 0) revert MarketNothingToClaim();
        claimed[msg.sender] = true;
        emit Claimed(msg.sender, amount);
        _push(msg.sender, amount);
    }

    /// @notice After the claim period of a YES/NO market, sends what is left (rounding dust and
    /// unclaimed winnings) to the reserve. Refunds of an INVALID market never expire.
    function sweep() external {
        if (state != State.Yes && state != State.No) revert MarketNotSettled();
        if (block.timestamp <= settledAt + claimPeriod) revert MarketClaimOpen();
        uint256 bal = token.balanceOf(address(this));
        emit Swept(bal);
        if (bal != 0) _push(reserve, bal);
    }

    // ------------------------------------------------------------------ views

    function rule() external view returns (Schema.Field[] memory fields, VerdictTypes.Binding[] memory bindings) {
        return (_fields, _bindings);
    }

    // ------------------------------------------------------------------ token transfers

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeCall(IERC20Min.transferFrom, (from, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert MarketTransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20Min.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert MarketTransferFailed();
    }
}
