// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITapeOutProcessor, ITapeOutFactory, IBeacon} from "./interfaces/ITapeOut.sol";
import {Netlist} from "./Netlist.sol";

/// @title PinRegistry
/// @notice Shared registry of approved TapeOut circuits (and plain contracts).
/// A circuit pin records, from live chain state at pin time: the netlist hash, the hash of the full
/// REF dependency closure, every processor in that closure with its code hash, and the circuit
/// implementation behind the processors' beacon. `isPinned` re-reads the live values and fails
/// closed (returns false, never reverts) on any difference or error.
/// Stored netlists have no setter (TAP-02 section 3), so the closure is hashed once; what can still
/// change is processor code, the beacon implementation, or the factory deregistering a processor.
/// Pinning is permissionless: a pin id commits to its content, so nobody can squat or alter one.
contract PinRegistry {
    using Netlist for bytes;

    enum Kind {
        None,
        Circuit,
        Contract
    }

    struct CircuitPin {
        uint256 chainId;
        address processor;
        uint256 circuitId;
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        uint32 gateCount;
        bytes32 netlistHash; // keccak256(netlist(circuitId))
        bytes32 refClosureHash; // keccak256 of every circuit reached through REF, recursively
        bytes32 schemaHash; // commitment to the off-chain input layout (Schema.hash)
        bytes32 certificateHash; // commitment to the off-chain Quote certificate
        address beacon; // circuit beacon embedded in every processor of the closure
        address implementation; // beacon.implementation() at pin time
        bytes32 implementationCodehash;
        address[] processors; // every distinct processor in the closure, root first
        bytes32[] processorCodehashes;
    }

    struct ContractPin {
        uint256 chainId;
        address target;
        bytes32 codehash;
        bytes4 implGetter; // zero: code hash only; else a view returning the implementation address
        address implementation;
        bytes32 implementationCodehash;
    }

    /// @notice Most circuits a closure may contain (root included); bounds pin and check cost.
    uint256 public constant MAX_CLOSURE = 64;
    /// @notice Gas given to each external read in `isPinned`.
    uint256 public constant CHECK_GAS = 50_000;

    ITapeOutFactory public immutable factory;

    mapping(bytes32 => Kind) public kindOf;
    mapping(bytes32 => CircuitPin) internal _circuits;
    mapping(bytes32 => ContractPin) internal _contracts;

    /// @notice A circuit was pinned.
    /// @param pinId Content-addressed pin id (chain, circuit, hashes, implementation)
    /// @param processor Processor contract of the root circuit
    /// @param circuitId Circuit id within the processor
    /// @param netlistHash keccak256 of the root netlist
    /// @param refClosureHash Hash of every circuit reached through REF, recursively
    /// @param schemaHash Commitment to the input layout (Schema.hash)
    /// @param certificateHash Commitment to the Quote certificate
    /// @param pinner Address that called `pin`
    event CircuitPinned(
        bytes32 indexed pinId,
        address indexed processor,
        uint256 indexed circuitId,
        bytes32 netlistHash,
        bytes32 refClosureHash,
        bytes32 schemaHash,
        bytes32 certificateHash,
        address pinner
    );
    /// @notice A plain contract was pinned.
    /// @param pinId Content-addressed pin id
    /// @param target Pinned contract
    /// @param implementation Implementation read through the getter, or zero for a code-hash-only pin
    /// @param pinner Address that called `pinContract`
    event ContractPinned(bytes32 indexed pinId, address indexed target, address implementation, address pinner);

    error PinExists(bytes32 pinId);
    error PinNotCPU(address cpu);
    error PinNotBeaconProxy(address cpu, address beacon);
    error PinReadFailed(address target);
    error PinClosureTooLarge();
    error PinNoCode(address target);

    constructor(ITapeOutFactory factory_) {
        factory = factory_;
    }

    // ------------------------------------------------------------------ circuit pins

    function pin(address processor, uint256 circuitId, bytes32 schemaHash, bytes32 certificateHash)
        external
        returns (bytes32 pinId)
    {
        CircuitPin memory m;
        m.chainId = block.chainid;
        m.processor = processor;
        m.circuitId = circuitId;
        m.schemaHash = schemaHash;
        m.certificateHash = certificateHash;
        m.beacon = factory.circuitBeacon();
        m.implementation = IBeacon(m.beacon).implementation();
        if (m.implementation.code.length == 0) revert PinNoCode(m.implementation);
        m.implementationCodehash = m.implementation.codehash;
        (m.nIn, m.nOut, m.nState, m.gateCount) = ITapeOutProcessor(processor).circuitInfo(circuitId);

        bytes memory rootNetlist = ITapeOutProcessor(processor).netlist(circuitId);
        m.netlistHash = keccak256(rootNetlist);
        (m.refClosureHash, m.processors) = _closure(processor, circuitId, rootNetlist);
        m.processorCodehashes = new bytes32[](m.processors.length);
        for (uint256 i; i < m.processors.length; i++) {
            address cpu = m.processors[i];
            if (!factory.isCPU(cpu)) revert PinNotCPU(cpu);
            if (!_embeds(cpu, m.beacon)) revert PinNotBeaconProxy(cpu, m.beacon);
            m.processorCodehashes[i] = cpu.codehash;
        }

        pinId = keccak256(
            abi.encode(
                Kind.Circuit,
                m.chainId,
                m.processor,
                m.circuitId,
                m.netlistHash,
                m.refClosureHash,
                m.schemaHash,
                m.certificateHash,
                m.implementation
            )
        );
        if (kindOf[pinId] != Kind.None) revert PinExists(pinId);
        kindOf[pinId] = Kind.Circuit;
        _circuits[pinId] = m;

        emit CircuitPinned(
            pinId, processor, circuitId, m.netlistHash, m.refClosureHash, schemaHash, certificateHash, msg.sender
        );
    }

    /// @dev Breadth-first walk of REF records. The closure hash covers every reached circuit except
    /// the root, as (cpu, id, keccak256(netlist)) in discovery order; the order is fixed by the
    /// netlists themselves, so the hash is deterministic.
    function _closure(address rootCpu, uint256 rootId, bytes memory rootNetlist)
        private
        view
        returns (bytes32 closureHash, address[] memory procs)
    {
        address[] memory cpus = new address[](MAX_CLOSURE);
        uint256[] memory ids = new uint256[](MAX_CLOSURE);
        bytes32[] memory hashes = new bytes32[](MAX_CLOSURE);
        address[] memory distinct = new address[](MAX_CLOSURE);
        cpus[0] = rootCpu;
        ids[0] = rootId;
        hashes[0] = keccak256(rootNetlist);
        distinct[0] = rootCpu;
        uint256 n = 1;
        uint256 nProcs = 1;

        for (uint256 head; head < n; head++) {
            bytes memory nl = head == 0 ? rootNetlist : ITapeOutProcessor(cpus[head]).netlist(ids[head]);
            Netlist.Ref[] memory r = nl.refs();
            for (uint256 j; j < r.length; j++) {
                (address c, uint256 id) = (r[j].cpu, uint256(r[j].id));
                bool seen;
                for (uint256 k; k < n; k++) {
                    if (cpus[k] == c && ids[k] == id) {
                        seen = true;
                        break;
                    }
                }
                if (seen) continue;
                if (n == MAX_CLOSURE) revert PinClosureTooLarge();
                if (!factory.isCPU(c)) revert PinNotCPU(c);
                cpus[n] = c;
                ids[n] = id;
                hashes[n] = keccak256(ITapeOutProcessor(c).netlist(id));
                n++;
                bool known;
                for (uint256 k; k < nProcs; k++) {
                    if (distinct[k] == c) {
                        known = true;
                        break;
                    }
                }
                if (!known) distinct[nProcs++] = c;
            }
        }

        // Hash entries 1..n-1 (the root is pinned separately by processor, id and netlistHash).
        bytes memory packed;
        for (uint256 k = 1; k < n; k++) {
            packed = abi.encodePacked(packed, cpus[k], ids[k], hashes[k]);
        }
        closureHash = keccak256(packed);

        procs = new address[](nProcs);
        for (uint256 k; k < nProcs; k++) {
            procs[k] = distinct[k];
        }
    }

    /// @dev True if `who` appears in the runtime code of `target`. TapeOut processors are beacon
    /// proxies with the beacon address as an immutable, so the code hash pins the beacon too.
    function _embeds(address target, address who) private view returns (bool) {
        bytes memory code = target.code;
        if (code.length < 20) return false;
        bytes20 w = bytes20(who);
        for (uint256 i; i + 20 <= code.length; i++) {
            bytes20 chunk;
            assembly {
                chunk := mload(add(add(code, 32), i))
            }
            if (chunk == w) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ contract pins

    /// @notice Pins a plain contract by code hash and, if `implGetter` is non-zero, by the
    /// implementation address that view returns (e.g. `implementation()` 0x5c60da1b on a beacon).
    /// A contract cannot read another contract's storage, so a proxy that keeps its implementation
    /// only in the ERC-1967 slot, with no getter, can be pinned by code hash only.
    function pinContract(address target, bytes4 implGetter) external returns (bytes32 pinId) {
        if (target.code.length == 0) revert PinNoCode(target);
        address impl;
        if (implGetter != bytes4(0)) {
            bool ok;
            (ok, impl) = _readAddress(target, abi.encodeWithSelector(implGetter));
            if (!ok || impl.code.length == 0) revert PinReadFailed(target);
        }
        bytes32 implHash = impl == address(0) ? bytes32(0) : impl.codehash;
        pinId = keccak256(abi.encode(Kind.Contract, block.chainid, target, target.codehash, implGetter, impl, implHash));
        if (kindOf[pinId] != Kind.None) revert PinExists(pinId);
        kindOf[pinId] = Kind.Contract;
        _contracts[pinId] = ContractPin(block.chainid, target, target.codehash, implGetter, impl, implHash);
        emit ContractPinned(pinId, target, impl, msg.sender);
    }

    // ------------------------------------------------------------------ checks

    /// @notice True only if every pinned value still matches live chain state. Never reverts.
    function isPinned(bytes32 pinId) public view returns (bool) {
        Kind k = kindOf[pinId];
        if (k == Kind.Circuit) return _circuitOk(_circuits[pinId]);
        if (k == Kind.Contract) return _contractOk(_contracts[pinId]);
        return false;
    }

    function _circuitOk(CircuitPin storage p) private view returns (bool) {
        if (p.chainId != block.chainid) return false;
        (bool ok, address impl) = _readAddress(p.beacon, abi.encodeWithSelector(IBeacon.implementation.selector));
        if (!ok || impl != p.implementation || impl.codehash != p.implementationCodehash) return false;
        uint256 n = p.processors.length;
        for (uint256 i; i < n; i++) {
            address cpu = p.processors[i];
            if (cpu.codehash != p.processorCodehashes[i]) return false;
            if (!_readTrue(address(factory), abi.encodeWithSelector(ITapeOutFactory.isCPU.selector, cpu))) {
                return false;
            }
        }
        return true;
    }

    function _contractOk(ContractPin storage p) private view returns (bool) {
        if (p.chainId != block.chainid) return false;
        if (p.target.codehash != p.codehash) return false;
        if (p.implGetter == bytes4(0)) return true;
        (bool ok, address impl) = _readAddress(p.target, abi.encodeWithSelector(p.implGetter));
        return ok && impl == p.implementation && impl.codehash == p.implementationCodehash;
    }

    function _readAddress(address target, bytes memory data) private view returns (bool, address) {
        (bool ok, uint256 w) = _readWord(target, data);
        if (!ok || w >> 160 != 0) return (false, address(0));
        return (true, address(uint160(w)));
    }

    function _readTrue(address target, bytes memory data) private view returns (bool) {
        (bool ok, uint256 w) = _readWord(target, data);
        return ok && w == 1;
    }

    /// @dev Staticcall with a gas cap that copies at most one word back (no return-data bomb).
    /// Succeeds only if the call succeeded and returned exactly 32 bytes.
    function _readWord(address target, bytes memory data) private view returns (bool ok, uint256 w) {
        uint256 g = CHECK_GAS;
        assembly {
            ok := staticcall(g, target, add(data, 32), mload(data), 0, 0)
            if iszero(eq(returndatasize(), 32)) { ok := 0 }
            if ok {
                returndatacopy(0, 0, 32)
                w := mload(0)
            }
        }
    }

    // ------------------------------------------------------------------ views

    function circuitPin(bytes32 pinId) external view returns (CircuitPin memory) {
        return _circuits[pinId];
    }

    /// @notice The fields an evaluator needs, without the closure arrays.
    function evalInfo(bytes32 pinId)
        external
        view
        returns (address processor, uint256 circuitId, uint32 nIn, uint32 nOut, bytes32 netlistHash, bytes32 schemaHash)
    {
        CircuitPin storage p = _circuits[pinId];
        return (p.processor, p.circuitId, p.nIn, p.nOut, p.netlistHash, p.schemaHash);
    }

    function contractPin(bytes32 pinId) external view returns (ContractPin memory) {
        return _contracts[pinId];
    }
}
