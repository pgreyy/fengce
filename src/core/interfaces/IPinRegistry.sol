// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IPinRegistry
/// @notice External surface of PinRegistry: a shared registry of approved TapeOut circuits and plain
/// contracts. A pin records live chain state at pin time; `isPinned` re-reads it and returns false on
/// any difference or error (it never reverts). Pin ids are content-addressed.
interface IPinRegistry {
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
        bytes32 netlistHash;
        bytes32 refClosureHash;
        bytes32 schemaHash;
        bytes32 certificateHash;
        address beacon;
        address implementation;
        bytes32 implementationCodehash;
        address[] processors;
        bytes32[] processorCodehashes;
    }

    struct ContractPin {
        uint256 chainId;
        address target;
        bytes32 codehash;
        bytes4 implGetter;
        address implementation;
        bytes32 implementationCodehash;
    }

    /// @notice A circuit was pinned.
    /// @param pinId Content-addressed pin id
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

    /// @notice Most circuits a dependency closure may contain (root included).
    function MAX_CLOSURE() external view returns (uint256);
    /// @notice Gas given to each external read in `isPinned`.
    function CHECK_GAS() external view returns (uint256);
    /// @notice The TapeOut processor factory this registry trusts for `isCPU` and the circuit beacon.
    function factory() external view returns (address);
    /// @notice What a pin id refers to (None if unknown).
    function kindOf(bytes32 pinId) external view returns (Kind);

    /// @notice Pins a circuit and its full REF closure from live chain state.
    function pin(address processor, uint256 circuitId, bytes32 schemaHash, bytes32 certificateHash)
        external
        returns (bytes32 pinId);

    /// @notice Pins a plain contract by code hash and, if `implGetter` is non-zero, by the address it returns.
    function pinContract(address target, bytes4 implGetter) external returns (bytes32 pinId);

    /// @notice True only if every pinned value still matches live chain state. Never reverts.
    function isPinned(bytes32 pinId) external view returns (bool);

    function circuitPin(bytes32 pinId) external view returns (CircuitPin memory);

    /// @notice The fields an evaluator needs, without the closure arrays.
    function evalInfo(bytes32 pinId)
        external
        view
        returns (address processor, uint256 circuitId, uint32 nIn, uint32 nOut, bytes32 netlistHash, bytes32 schemaHash);

    function contractPin(bytes32 pinId) external view returns (ContractPin memory);
}
