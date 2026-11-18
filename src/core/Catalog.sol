// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";

/// @title Catalog
/// @notice Public, append-only list of pinned circuits that wallets can install, each with the Quote
/// certificate it was pinned with. The `certificateHash` is copied from the pin itself, so an entry
/// always refers to the certificate the pin committed to; `tier` and `gasFullPath` are the lister's
/// statement of what that certificate says (certificates are not signed: readers should fetch the
/// certificate, check keccak256(canonical JSON) == certificateHash, and compare). Imports only core.
contract Catalog {
    enum Tier {
        Green,
        Amber,
        Red,
        Unsupported
    }

    struct Entry {
        bytes32 pinId;
        bytes32 certificateHash;
        Tier tier;
        uint64 gasFullPath;
        address lister;
        uint64 listedAt;
        bool active;
        string uri; // where the certificate JSON can be fetched (optional)
    }

    PinRegistry public immutable registry;
    bytes32[] internal _ids;
    mapping(bytes32 pinId => Entry) internal _entries;

    /// @notice A pinned circuit was listed.
    /// @param pinId Pin id
    /// @param certificateHash Certificate hash stored in the pin
    /// @param tier Budget tier stated by the lister
    /// @param gasFullPath Measured gas stated by the lister
    /// @param lister Address that listed it
    /// @param uri Certificate location
    event Listed(bytes32 indexed pinId, bytes32 certificateHash, Tier tier, uint64 gasFullPath, address indexed lister, string uri);
    /// @notice A listing was withdrawn by its lister.
    /// @param pinId Pin id
    event Delisted(bytes32 indexed pinId);

    error CatalogNotPinned(bytes32 pinId);
    error CatalogNoCertificate(bytes32 pinId);
    error CatalogAlreadyListed(bytes32 pinId);
    error CatalogNotLister(address caller);

    constructor(PinRegistry registry_) {
        registry = registry_;
    }

    function list(bytes32 pinId, Tier tier, uint64 gasFullPath, string calldata uri) external {
        if (registry.kindOf(pinId) != PinRegistry.Kind.Circuit || !registry.isPinned(pinId)) revert CatalogNotPinned(pinId);
        bytes32 cert = registry.circuitPin(pinId).certificateHash;
        if (cert == bytes32(0)) revert CatalogNoCertificate(pinId);
        if (_entries[pinId].lister != address(0)) revert CatalogAlreadyListed(pinId);
        _entries[pinId] = Entry(pinId, cert, tier, gasFullPath, msg.sender, uint64(block.timestamp), true, uri);
        _ids.push(pinId);
        emit Listed(pinId, cert, tier, gasFullPath, msg.sender, uri);
    }

    function delist(bytes32 pinId) external {
        if (_entries[pinId].lister != msg.sender) revert CatalogNotLister(msg.sender);
        _entries[pinId].active = false;
        emit Delisted(pinId);
    }

    function count() external view returns (uint256) {
        return _ids.length;
    }

    function entryAt(uint256 i) external view returns (Entry memory) {
        return _entries[_ids[i]];
    }

    function entryOf(bytes32 pinId) external view returns (Entry memory) {
        return _entries[pinId];
    }

    /// @notice An entry is usable only while active and while its pin still holds.
    function isUsable(bytes32 pinId) external view returns (bool) {
        return _entries[pinId].active && registry.isPinned(pinId);
    }
}
