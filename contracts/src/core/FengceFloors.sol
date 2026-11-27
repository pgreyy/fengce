// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";
import {PolicyEngine} from "./PolicyEngine.sol";
import {Schema} from "./Schema.sol";
import {TxFacts} from "./TxFacts.sol";
import {Netlist} from "./Netlist.sol";
import {ITapeOutProcessor} from "./interfaces/ITapeOut.sol";

/// @title FengceFloors
/// @notice Policy floors: a minimum rule (for example set by an organisation) that an account's own policy
/// cannot go below. A floor is a pinned circuit with its own schema and bindings over the same policy
/// context. For every evaluation the adapter (FengceGuard) calls `check`: the floor must be part of the
/// account's policy (its circuit is in the policy's REF closure, verified once per policy with
/// `verifyPolicy`), and the floor circuit must allow too. The decision is floor AND policy.
///
/// Ownership: the account sets its floor once, naming the floor owner and a change delay (at least
/// MIN_DELAY). From then on only the floor owner can change or remove the floor, and only after that delay.
/// The account cannot detach this contract from its guard while a floor is set (FengceGuard asks
/// `hasFloor`). Owners holding every signature can still remove the guard itself through recovery.
contract FengceFloors is PolicyEngine {
    uint256 public constant MIN_DELAY = 1 days;
    uint256 internal constant MAX_CLOSURE = 64;

    struct Floor {
        bytes32 pinId; // 0 = no floor
        address owner;
        uint64 delay;
        bytes32 netlistHash;
        uint32 nIn;
        Schema.Field[] fields;
        TxFacts.Binding[] bindings;
        address cpu; // floor circuit identity, for the closure check
        uint256 circuitId;
    }

    struct Pending {
        uint256 readyAt; // 0 = nothing pending
        bytes32 changeHash; // keccak256(abi.encode(pinId, layout, bindings))
    }

    mapping(address account => Floor) internal _floors;
    mapping(address account => Pending) public pending;
    /// @notice The policy pin for which the floor was last found in the REF closure.
    mapping(address account => bytes32) public verifiedPolicy;

    /// @notice An account's floor was set or changed (pinId 0 = removed).
    /// @param account The account
    /// @param pinId Floor circuit pin
    /// @param owner Floor owner
    event FloorSet(address indexed account, bytes32 indexed pinId, address owner);
    /// @notice The floor owner proposed a change.
    /// @param account The account
    /// @param changeHash keccak256(abi.encode(pinId, layout, bindings))
    /// @param readyAt First time it can be executed
    event FloorChangeProposed(address indexed account, bytes32 changeHash, uint256 readyAt);
    /// @notice The floor was found in a policy's REF closure.
    /// @param account The account
    /// @param policyPin Policy pin
    event PolicyVerified(address indexed account, bytes32 policyPin);

    error FloorExists(address account);
    error FloorNotOwner(address caller);
    error FloorDelayTooShort();
    error FloorBadSchema();
    error FloorNotReady();
    error FloorNotInPolicy(address account, bytes32 policyPin);
    error FloorDenied(address account);

    constructor(PinRegistry registry_, uint256 evalGasCap_) PolicyEngine(registry_, evalGasCap_) {}

    // ------------------------------------------------------------------ setting

    /// @notice Called by the account, once: its floor, the floor owner and the change delay.
    function setFloor(
        address owner,
        uint64 delay,
        bytes32 pinId,
        Schema.Layout calldata layout,
        TxFacts.Binding[] calldata bindings
    ) external {
        if (_floors[msg.sender].pinId != bytes32(0)) revert FloorExists(msg.sender);
        if (delay < MIN_DELAY) revert FloorDelayTooShort();
        Floor storage f = _floors[msg.sender];
        f.owner = owner;
        f.delay = delay;
        _store(msg.sender, pinId, layout, bindings);
    }

    /// @notice Floor owner: propose a new floor (pinId 0 removes it). Executable after the delay.
    function proposeChange(address account, bytes32 pinId, Schema.Layout calldata layout, TxFacts.Binding[] calldata bindings)
        external
    {
        Floor storage f = _floors[account];
        if (msg.sender != f.owner || f.pinId == bytes32(0)) revert FloorNotOwner(msg.sender);
        bytes32 h = keccak256(abi.encode(pinId, layout, bindings));
        uint256 readyAt = block.timestamp + f.delay;
        pending[account] = Pending(readyAt, h);
        emit FloorChangeProposed(account, h, readyAt);
    }

    /// @notice Floor owner: execute the proposed change after the delay.
    function executeChange(address account, bytes32 pinId, Schema.Layout calldata layout, TxFacts.Binding[] calldata bindings)
        external
    {
        Floor storage f = _floors[account];
        if (msg.sender != f.owner) revert FloorNotOwner(msg.sender);
        Pending memory p = pending[account];
        if (p.readyAt == 0 || block.timestamp < p.readyAt || p.changeHash != keccak256(abi.encode(pinId, layout, bindings))) {
            revert FloorNotReady();
        }
        delete pending[account];
        delete verifiedPolicy[account];
        if (pinId == bytes32(0)) {
            delete _floors[account];
            emit FloorSet(account, bytes32(0), address(0));
            return;
        }
        _store(account, pinId, layout, bindings);
    }

    function _store(address account, bytes32 pinId, Schema.Layout calldata layout, TxFacts.Binding[] calldata bindings)
        private
    {
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);
        Schema.Layout memory l = layout;
        if (!registry.isPinned(pinId) || Schema.hash(l) != c.schemaHash || l.nIn != c.nIn || l.netlistHash != c.netlistHash) {
            revert FloorBadSchema();
        }
        Schema.validate(l);
        Floor storage f = _floors[account];
        f.pinId = pinId;
        f.netlistHash = c.netlistHash;
        f.nIn = c.nIn;
        f.cpu = c.processor;
        f.circuitId = c.circuitId;
        delete f.fields;
        delete f.bindings;
        for (uint256 i; i < l.fields.length; i++) {
            f.fields.push(l.fields[i]);
        }
        for (uint256 i; i < bindings.length; i++) {
            f.bindings.push(bindings[i]);
        }
        delete verifiedPolicy[account];
        emit FloorSet(account, pinId, f.owner);
    }

    // ------------------------------------------------------------------ closure check

    /// @notice Anyone: confirm that the account's floor circuit is in `policyPin`'s REF closure (walking the
    /// pinned netlists) and remember it. Needed once per policy before evaluations pass.
    function verifyPolicy(address account, bytes32 policyPin) external {
        Floor storage f = _floors[account];
        PinRegistry.CircuitPin memory c = registry.circuitPin(policyPin);
        if (!registry.isPinned(policyPin) || !_inClosure(c.processor, c.circuitId, f.cpu, f.circuitId)) {
            revert FloorNotInPolicy(account, policyPin);
        }
        verifiedPolicy[account] = policyPin;
        emit PolicyVerified(account, policyPin);
    }

    function _inClosure(address cpu, uint256 id, address floorCpu, uint256 floorId) private view returns (bool) {
        address[] memory cpus = new address[](MAX_CLOSURE);
        uint256[] memory ids = new uint256[](MAX_CLOSURE);
        (cpus[0], ids[0]) = (cpu, id);
        uint256 n = 1;
        for (uint256 head; head < n; head++) {
            Netlist.Ref[] memory r = Netlist.refs(ITapeOutProcessor(cpus[head]).netlist(ids[head]));
            for (uint256 j; j < r.length; j++) {
                if (r[j].cpu == floorCpu && r[j].id == floorId) return true;
                if (n < MAX_CLOSURE) (cpus[n], ids[n++]) = (r[j].cpu, r[j].id);
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ evaluation

    /// @notice Reverts unless the account has no floor, or the floor is part of `policyPin` and allows `ctx`.
    function check(address account, bytes32 policyPin, TxFacts.Facts calldata ctx) external view {
        Floor storage f = _floors[account];
        if (f.pinId == bytes32(0)) return;
        if (verifiedPolicy[account] != policyPin) revert FloorNotInPolicy(account, policyPin);
        Schema.Layout memory l = Schema.Layout(f.netlistHash, f.nIn, f.fields);
        bytes memory out = _evaluate(f.pinId, Schema.encode(l, TxFacts.values(ctx, f.bindings)));
        if (uint8(out[0]) & 1 != 1) revert FloorDenied(account);
    }

    function hasFloor(address account) external view returns (bool) {
        return _floors[account].pinId != bytes32(0);
    }

    function floorOf(address account) external view returns (bytes32 pinId, address owner, uint64 delay) {
        Floor storage f = _floors[account];
        return (f.pinId, f.owner, f.delay);
    }
}
