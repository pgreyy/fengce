// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";
import {PolicyEngine} from "./PolicyEngine.sol";

/// @title Catalog
/// @notice Public, append-only list of pinned circuits that wallets can install.
///
/// Trust: a listing carries a manifest (description, schema hash, test vectors). At listing time the
/// Catalog runs every vector through the pinned circuit on-chain (fail-closed PolicyEngine path) and
/// reverts on any mismatch, so a listed entry is proof that the circuit, as pinned, produced exactly the
/// stated outputs. The tier is measured on-chain from the gas of those evaluations (pin checks included),
/// with thresholds shared with the SDK (sdk/src/tiers.json, sdk/src/tiers.ts). The certificate hash is copied
/// from the pin.
///
/// Revenue: each listing can set an install fee in native currency. `payInstall` splits it between the
/// circuit's designer (DESIGNER_BPS) and the treasury; both withdraw their balance. Imports only core.
contract Catalog is PolicyEngine {
    enum Tier {
        Green,
        Amber,
        Red
    }

    struct Vector {
        bytes input; // exactly ceil(nIn/8) bytes
        bytes expectedOutput; // exactly ceil(nOut/8) bytes
    }

    struct Manifest {
        bytes32 pinId;
        string description; // plain-language description of the policy
        bytes32 schemaHash; // must equal the pin's schemaHash
        Vector[] vectors; // at least one; outputs with bit 0 = 1 count as "allow", 0 as "deny"
        address designer; // receives the designer share of install fees
        uint256 installFee; // in wei, 0 for free
        string uri; // where the certificate and schema JSON can be fetched (optional)
    }

    struct Entry {
        bytes32 pinId;
        bytes32 certificateHash;
        bytes32 schemaHash;
        bytes32 vectorsHash; // keccak256(abi.encode(vectors))
        uint32 allowVectors;
        uint32 denyVectors;
        uint64 measuredGas; // max gas of one vector's evaluation, measured at listing
        Tier tier;
        address lister;
        address designer;
        uint256 installFee;
        uint64 listedAt;
        bool active;
        string description;
        string uri;
    }

    /// Thresholds on measured evaluation gas; must equal sdk/src/tiers.json (checked by a unit test).
    uint256 public constant GREEN_MAX_GAS = 1_000_000;
    uint256 public constant AMBER_MAX_GAS = 3_500_000;
    /// Designer share of an install fee, in basis points; the rest goes to the treasury.
    uint256 public constant DESIGNER_BPS = 8_000;

    address public immutable treasury;
    bytes32[] internal _ids;
    mapping(bytes32 pinId => Entry) internal _entries;
    mapping(address => uint256) public balances;

    /// @notice A circuit was listed after all its test vectors passed on-chain.
    /// @param pinId Pin id
    /// @param designer Designer receiving fee shares
    /// @param tier Tier from measured gas
    /// @param measuredGas Max gas of one vector evaluation
    /// @param allowVectors Vectors whose expected bit 0 is 1
    /// @param denyVectors Vectors whose expected bit 0 is 0
    event Listed(
        bytes32 indexed pinId, address indexed designer, Tier tier, uint64 measuredGas, uint32 allowVectors, uint32 denyVectors
    );
    /// @notice A listing was withdrawn.
    /// @param pinId Pin id
    event Delisted(bytes32 indexed pinId);
    /// @notice An install fee was paid and split.
    /// @param pinId Pin id
    /// @param payer Payer (usually the Safe)
    /// @param designer Designer credited
    /// @param designerAmount Designer share
    /// @param treasuryAmount Treasury share
    event FeePaid(bytes32 indexed pinId, address indexed payer, address indexed designer, uint256 designerAmount, uint256 treasuryAmount);
    /// @notice A designer or the treasury withdrew its balance.
    /// @param to Recipient
    /// @param amount Amount
    event Withdrawn(address indexed to, uint256 amount);

    error CatalogNotPinned(bytes32 pinId);
    error CatalogSchemaMismatch(bytes32 pinId);
    error CatalogNoVectors();
    error CatalogVectorMismatch(uint256 index, bytes output);
    error CatalogAlreadyListed(bytes32 pinId);
    error CatalogNotLister(address caller);
    error CatalogNotListed(bytes32 pinId);
    error CatalogWrongFee(uint256 sent, uint256 fee);
    error CatalogTransferFailed();

    constructor(PinRegistry registry_, uint256 evalGasCap_, address treasury_) PolicyEngine(registry_, evalGasCap_) {
        treasury = treasury_;
    }

    function list(Manifest calldata m) external {
        bytes32 pinId = m.pinId;
        if (registry.kindOf(pinId) != PinRegistry.Kind.Circuit || !registry.isPinned(pinId)) revert CatalogNotPinned(pinId);
        if (_entries[pinId].lister != address(0)) revert CatalogAlreadyListed(pinId);
        PinRegistry.CircuitPin memory c = registry.circuitPin(pinId);
        if (m.schemaHash != c.schemaHash) revert CatalogSchemaMismatch(pinId);
        if (m.vectors.length == 0) revert CatalogNoVectors();

        uint256 maxGas;
        uint32 allows;
        uint32 denies;
        for (uint256 i; i < m.vectors.length; i++) {
            uint256 g = gasleft();
            bytes memory out = _evaluate(pinId, m.vectors[i].input);
            g -= gasleft();
            if (keccak256(out) != keccak256(m.vectors[i].expectedOutput)) revert CatalogVectorMismatch(i, out);
            if (g > maxGas) maxGas = g;
            if (uint8(out[0]) & 1 == 1) allows++;
            else denies++;
        }

        Entry storage e = _entries[pinId];
        e.pinId = pinId;
        e.certificateHash = c.certificateHash;
        e.schemaHash = c.schemaHash;
        e.vectorsHash = keccak256(abi.encode(m.vectors));
        e.allowVectors = allows;
        e.denyVectors = denies;
        e.measuredGas = uint64(maxGas);
        e.tier = tierFor(maxGas);
        e.lister = msg.sender;
        e.designer = m.designer;
        e.installFee = m.installFee;
        e.listedAt = uint64(block.timestamp);
        e.active = true;
        e.description = m.description;
        e.uri = m.uri;
        _ids.push(pinId);
        emit Listed(pinId, m.designer, e.tier, uint64(maxGas), allows, denies);
    }

    function tierFor(uint256 gas) public pure returns (Tier) {
        if (gas <= GREEN_MAX_GAS) return Tier.Green;
        if (gas <= AMBER_MAX_GAS) return Tier.Amber;
        return Tier.Red;
    }

    function delist(bytes32 pinId) external {
        if (_entries[pinId].lister != msg.sender) revert CatalogNotLister(msg.sender);
        _entries[pinId].active = false;
        emit Delisted(pinId);
    }

    /// @notice Pays a listing's install fee; credits DESIGNER_BPS to the designer and the rest to the treasury.
    function payInstall(bytes32 pinId) external payable {
        Entry storage e = _entries[pinId];
        if (!e.active) revert CatalogNotListed(pinId);
        if (msg.value != e.installFee) revert CatalogWrongFee(msg.value, e.installFee);
        uint256 designerAmount = msg.value * DESIGNER_BPS / 10_000;
        uint256 treasuryAmount = msg.value - designerAmount;
        balances[e.designer] += designerAmount;
        balances[treasury] += treasuryAmount;
        emit FeePaid(pinId, msg.sender, e.designer, designerAmount, treasuryAmount);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert CatalogTransferFailed();
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
