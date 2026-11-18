// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISafe} from "@safe/interfaces/ISafe.sol";
import {TxFacts} from "../core/TxFacts.sol";
import {IFengcePolicy} from "../core/interfaces/IFengcePolicy.sol";

/// @title FengceInspector
/// @notice Outcome checks: what a transaction actually did, not only what it said it would do.
///
/// Before execution an adapter (FengceGuard on the owner and module paths, FengceHook for ERC-7579)
/// calls `snapshot(account)`; after execution it calls `verify(account, success, policy)`. The Inspector
/// records, in transient storage:
/// - the balances of the account's watched assets (address(0) = native currency);
/// - the account's allowances on those assets to its listed spenders;
/// - a fingerprint of the account's owners, threshold, modules (first page), guard, module guard and
///   fallback handler.
/// After execution it recomputes them:
/// - any change to the fingerprint is denied outright (such changes must go through the admin path,
///   where adapters take no snapshot);
/// - the total decrease of watched balances (`outflow`) and total increase of listed allowances
///   (`allowanceIncrease`) are passed to the account's policy as outcome facts (context version 2) through
///   `IFengcePolicy.checkContext`, which reverts unless the same circuit allows them. In this check the
///   transaction fields of the context are zero; the pre-execution check had the outcome fields at zero,
///   and both must allow.
/// Nested checks (a module transaction made during an owner transaction) are counted; only the
/// outermost snapshot and verification compare state, so the outer baseline cannot be replaced.
/// Only adapters registered at construction may snapshot or verify, so a contract called during the
/// transaction cannot reset or clear the baseline.
contract FengceInspector {
    uint256 internal constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    uint256 internal constant MODULE_GUARD_SLOT = 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947;
    uint256 internal constant FALLBACK_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;
    uint256 public constant MAX_ASSETS = 8;
    uint256 public constant MAX_SPENDERS = 8;
    uint256 internal constant READ_GAS = 100_000;

    struct Watch {
        address[] assets; // address(0) = native currency
        address[] spenders;
    }

    mapping(address => bool) public isAdapter;
    mapping(address account => Watch) internal _watch;

    /// @notice An adapter set an account's watched assets and spenders.
    /// @param account The account
    /// @param assets Watched assets (address(0) = native)
    /// @param spenders Listed spenders
    event WatchSet(address indexed account, address[] assets, address[] spenders);

    error InspectorNotAdapter(address caller);
    error InspectorTooMany();
    error InspectorConfigChanged(address account);
    error InspectorUnreadable(address account, address asset);

    constructor(address[] memory adapters) {
        for (uint256 i; i < adapters.length; i++) {
            isAdapter[adapters[i]] = true;
        }
    }

    modifier onlyAdapter() {
        if (!isAdapter[msg.sender]) revert InspectorNotAdapter(msg.sender);
        _;
    }

    /// @param data abi.encode(address[] assets, address[] spenders)
    function configureFor(address account, bytes calldata data) external onlyAdapter {
        (address[] memory assets, address[] memory spenders) = abi.decode(data, (address[], address[]));
        if (assets.length > MAX_ASSETS || spenders.length > MAX_SPENDERS) revert InspectorTooMany();
        _watch[account] = Watch(assets, spenders);
        emit WatchSet(account, assets, spenders);
    }

    function watchOf(address account) external view returns (address[] memory assets, address[] memory spenders) {
        Watch storage w = _watch[account];
        return (w.assets, w.spenders);
    }

    // ------------------------------------------------------------------ snapshot / verify

    function snapshot(address account) external onlyAdapter {
        bytes32 base = _base(account);
        uint256 depth;
        assembly {
            depth := tload(base)
            tstore(base, add(depth, 1))
        }
        if (depth != 0) return; // nested: keep the outer baseline
        bytes32 fp = _fingerprint(account);
        uint256[] memory v = _values(account);
        assembly {
            tstore(add(base, 1), fp)
        }
        for (uint256 i; i < v.length; i++) {
            uint256 x = v[i];
            assembly {
                tstore(add(base, add(2, i)), x)
            }
        }
    }

    /// @notice Reverts if the outermost check finds a configuration change or the policy denies the outcome.
    function verify(address account, bool success, address policy) external onlyAdapter {
        bytes32 base = _base(account);
        uint256 depth;
        assembly {
            depth := tload(base)
        }
        if (depth == 0) return; // no snapshot (admin path)
        assembly {
            tstore(base, sub(depth, 1))
        }
        if (depth != 1 || !success) return; // inner level, or the execution failed and was undone

        bytes32 fpBefore;
        assembly {
            fpBefore := tload(add(base, 1))
        }
        if (_fingerprint(account) != fpBefore) revert InspectorConfigChanged(account);

        Watch storage w = _watch[account];
        uint256[] memory afterV = _values(account);
        uint256 nAssets = w.assets.length;
        uint256 outflow;
        uint256 allowanceIncrease;
        for (uint256 i; i < afterV.length; i++) {
            uint256 b;
            assembly {
                b := tload(add(base, add(2, i)))
            }
            uint256 a = afterV[i];
            if (i < nAssets) {
                if (a < b) outflow += b - a;
            } else if (a > b) {
                allowanceIncrease += a - b;
            }
        }
        TxFacts.Facts memory f = TxFacts.base(TxFacts.Kind.Call, account, address(0), 0, address(0), 0, bytes4(0));
        f.outflow = outflow;
        f.allowanceIncrease = allowanceIncrease;
        IFengcePolicy(policy).checkContext(account, f);
    }

    // ------------------------------------------------------------------ reads

    function _base(address account) private pure returns (bytes32) {
        return keccak256(abi.encode("fengce.inspector", account));
    }

    /// @dev Safe accounts (Safe, Safe7579): owners, threshold, modules, guards, fallback handler. Other accounts
    /// (no `getThreshold`): only the account's code hash, so a configuration change inside a non-Safe account is
    /// not detected here; its outcome (outflow, allowance increase) is still checked.
    function _fingerprint(address account) private view returns (bytes32) {
        (bool isSafe, bytes memory ret) = account.staticcall(abi.encodeWithSignature("getThreshold()"));
        if (!isSafe || ret.length != 32) return keccak256(abi.encode(account.codehash));
        ISafe s = ISafe(payable(account));
        (address[] memory modules,) = s.getModulesPaginated(address(1), 64);
        return keccak256(
            abi.encode(
                s.getOwners(),
                s.getThreshold(),
                modules,
                s.getStorageAt(GUARD_SLOT, 1),
                s.getStorageAt(MODULE_GUARD_SLOT, 1),
                s.getStorageAt(FALLBACK_SLOT, 1)
            )
        );
    }

    /// @dev Balances of each watched asset, then allowance(account, spender) for each ERC-20 asset and spender.
    function _values(address account) private view returns (uint256[] memory v) {
        Watch storage w = _watch[account];
        uint256 nA = w.assets.length;
        uint256 nS = w.spenders.length;
        v = new uint256[](nA + nA * nS);
        for (uint256 i; i < nA; i++) {
            address asset = w.assets[i];
            if (asset == address(0)) {
                v[i] = account.balance;
                continue;
            }
            v[i] = _read(account, asset, abi.encodeWithSelector(0x70a08231, account)); // balanceOf
            for (uint256 j; j < nS; j++) {
                v[nA + i * nS + j] = _read(account, asset, abi.encodeWithSelector(0xdd62ed3e, account, w.spenders[j])); // allowance
            }
        }
    }

    function _read(address account, address asset, bytes memory data) private view returns (uint256 w) {
        bool ok;
        uint256 g = READ_GAS;
        assembly {
            ok := staticcall(g, asset, add(data, 32), mload(data), 0, 0)
            if iszero(eq(returndatasize(), 32)) { ok := 0 }
            if ok {
                returndatacopy(0, 0, 32)
                w := mload(0)
            }
        }
        if (!ok) revert InspectorUnreadable(account, asset); // fail closed
    }
}
