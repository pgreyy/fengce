// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read-only part of a TapeOut processor contract (TAP-02 section 6).
interface ITapeOutProcessor {
    function nextId() external view returns (uint256); // 0x61b8ce8c
    function circuitInfo(uint256 id)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount); // 0x084d60f1
    function netlist(uint256 id) external view returns (bytes memory); // 0x3fc4be56
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory); // 0x934d06ea
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs); // 0xe8281a1a
}

/// @notice The parts of the TapeOut processor factory that Fengce reads.
interface ITapeOutFactory {
    function isCPU(address cpu) external view returns (bool); // 0x5f5a364f
    function circuitBeacon() external view returns (address); // 0xddcb22fa
    function isSealed() external view returns (bool); // 0x631f9852
    function cpuCount() external view returns (uint256); // 0xa94da8a7
    function cpuAt(uint256 i) external view returns (address); // 0x4bc7cbbd
}

interface IBeacon {
    function implementation() external view returns (address); // 0x5c60da1b
}
