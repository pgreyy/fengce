// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ISafe} from "@safe/interfaces/ISafe.sol";
import {Enum} from "@safe/libraries/Enum.sol";

import {PinRegistry} from "../src/core/PinRegistry.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {Schema} from "../src/core/Schema.sol";
import {TxFacts} from "../src/core/TxFacts.sol";
import {Netlist} from "../src/core/Netlist.sol";
import {Tick} from "../src/core/Tick.sol";
import {Catalog} from "../src/core/Catalog.sol";
import {FengceFloors} from "../src/core/FengceFloors.sol";
import {ITapeOutFactory, ITapeOutProcessor, IBeacon} from "../src/core/interfaces/ITapeOut.sol";
import {FengceGuard} from "../src/safe/FengceGuard.sol";
import {FengceInspector} from "../src/safe/FengceInspector.sol";
import {FengceSignatureVerifier} from "../src/safe/FengceSignatureVerifier.sol";
import {FengceStrictHandler} from "../src/safe/FengceStrictHandler.sol";
import {AgentExecutor} from "../src/safe/AgentExecutor.sol";
import {FengceHook} from "../src/erc7579/FengceHook.sol";
import {FengceBinding} from "../src/binding/FengceBinding.sol";
import {BoundVault} from "../src/binding/BoundVault.sol";
import {UniswapV3RouterDecoder} from "../src/decoders/UniswapV3RouterDecoder.sol";
import {UniswapV2RouterDecoder} from "../src/decoders/UniswapV2RouterDecoder.sol";
import {AaveV3PoolDecoder} from "../src/decoders/AaveV3PoolDecoder.sol";

interface IProxyFactoryLive {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) external returns (address);
    function proxyCreationCode() external pure returns (bytes memory);
}

interface IERC20Live {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

/// @notice Live deployment of Fengce on X Layer mainnet (chain 196), in one broadcast run:
///   GIT_COMMIT=$(git rev-parse HEAD) DEMO_AGENT=<agent> forge script script/DeployLive.s.sol --rpc-url xlayer \
///     --account fengce-deployer --sender <deployer> --broadcast --slow
/// Without --broadcast it only simulates. Resumable: every step first checks whether it is already done (code at
/// the CREATE2 address, pin exists, listing exists, Safe exists, each Safe setup step) and skips it, so the same
/// command can be run again after an interruption.
///
/// Steps: (1) deploy every contract through the CREATE2 deployer; (2) pin five seed policies (each with its stored
/// Quote certificate, sdk/quotes/*.json) and list them in the Catalog, which runs their test vectors on-chain;
/// (3) if the deployer holds at least 2 USDT0 (or the demo Safe already exists): create a demo Safe 1.5.0 owned by
/// the deployer, install FengceGuard as both guards with a USDT0 cap of 1, register DEMO_AGENT in AgentExecutor and
/// fund the Safe with 2 USDT0. Writes deployments/xlayer-196.json (addresses) and
/// deployments/manifest-xlayer-196.json (everything needed to reproduce and verify the deployment).
contract DeployLive is Script {
    address constant CREATE2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant TAPEOUT = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address constant SAFE_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    bytes32 constant GUARD_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
    bytes32 constant MODULE_GUARD_SLOT = 0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947;
    uint256 constant CAP = 2_000_000; // eval gas cap for engines
    uint256 constant DEMO_CAP = 1_000_000; // 1 USDT0 (6 decimals)
    uint256 constant DEMO_FUNDING = 2_000_000; // 2 USDT0
    string constant VERSION = "v0.2.0";

    struct Rec {
        string name;
        address addr;
        bytes32 salt;
        bytes32 initCodeHash;
        bytes args;
    }

    address deployer;
    PinRegistry reg;
    FengceGuard guard;
    FengceHook hook;
    FengceInspector inspector;
    Catalog catalog;
    AgentExecutor agentExec;
    FengceBinding binding;
    BoundVault vault;
    Rec[] recs;
    string[] seedKeys;
    bytes32[] seedPins;
    string circuitsJson;
    bytes32 nandPin;
    Schema.Layout nandLayout;
    address demoSafe;
    address demoAgent;
    address treasury;
    string[] log;

    function run() external {
        require(block.chainid == 196, "X Layer mainnet only");
        deployer = msg.sender;
        demoAgent = vm.envOr("DEMO_AGENT", address(0));
        vm.startBroadcast();
        _deployAll();
        _seeds();
        _demo();
        vm.stopBroadcast();
        _writeAddresses();
        _writeManifest();
    }

    // ================================================================== contracts

    function _d(string memory name, bytes memory creationCode, bytes memory args) internal returns (address a) {
        bytes32 salt = keccak256(abi.encodePacked("fengce.", name, ".", VERSION));
        bytes memory initCode = abi.encodePacked(creationCode, args);
        a = vm.computeCreate2Address(salt, keccak256(initCode), CREATE2);
        if (a.code.length == 0) {
            (bool ok,) = CREATE2.call(abi.encodePacked(salt, initCode));
            require(ok && a.code.length > 0, string.concat("deploy failed: ", name));
            console2.log("deployed", name, a);
        } else {
            console2.log("exists  ", name, a);
        }
        recs.push(Rec(name, a, salt, keccak256(initCode), args));
    }

    function _deployAll() internal {
        reg = PinRegistry(_d("PinRegistry", type(PinRegistry).creationCode, abi.encode(TAPEOUT)));
        _d("PolicyEngine", type(PolicyEngine).creationCode, abi.encode(reg, CAP));
        guard = FengceGuard(_d("FengceGuard", type(FengceGuard).creationCode, abi.encode(reg, CAP)));
        hook = FengceHook(_d("FengceHook", type(FengceHook).creationCode, abi.encode(reg, CAP)));
        address[] memory adapters = new address[](2);
        (adapters[0], adapters[1]) = (address(guard), address(hook));
        inspector = FengceInspector(_d("FengceInspector", type(FengceInspector).creationCode, abi.encode(adapters)));
        _d("FengceFloors", type(FengceFloors).creationCode, abi.encode(reg, CAP));
        binding = FengceBinding(_d("FengceBinding", type(FengceBinding).creationCode, abi.encode(guard)));
        _d("FengceSignatureVerifier", type(FengceSignatureVerifier).creationCode, abi.encode(guard));
        _d("FengceStrictHandler", type(FengceStrictHandler).creationCode, "");
        agentExec = AgentExecutor(_d("AgentExecutor", type(AgentExecutor).creationCode, abi.encode(guard)));
        _d("Tick", type(Tick).creationCode, abi.encode(reg, uint256(1_000_000)));
        // Catalog treasury: a Safe 1.5.0 owned by the deployer (threshold 1), created first so it can be the
        // Catalog's fixed treasury.
        treasury = _ensureSafe("treasury");
        catalog = Catalog(_d("Catalog", type(Catalog).creationCode, abi.encode(reg, CAP, treasury)));
        _d("UniswapV3RouterDecoder", type(UniswapV3RouterDecoder).creationCode, "");
        _d("UniswapV2RouterDecoder", type(UniswapV2RouterDecoder).creationCode, "");
        _d("AaveV3PoolDecoder", type(AaveV3PoolDecoder).creationCode, "");
    }

    // ================================================================== seed policies

    /// @dev The pin id PinRegistry.pin would return, computed the same way, so an existing pin is detected.
    function _previewPinId(address cpu, uint256 id, bytes32 schemaHash, bytes32 cert) internal view returns (bytes32) {
        address[] memory cpus = new address[](64);
        uint256[] memory ids = new uint256[](64);
        bytes32[] memory hashes = new bytes32[](64);
        (cpus[0], ids[0], hashes[0]) = (cpu, id, keccak256(ITapeOutProcessor(cpu).netlist(id)));
        uint256 n = 1;
        for (uint256 head; head < n; head++) {
            Netlist.Ref[] memory r = Netlist.refs(ITapeOutProcessor(cpus[head]).netlist(ids[head]));
            for (uint256 j; j < r.length; j++) {
                bool seen;
                for (uint256 k; k < n; k++) {
                    if (cpus[k] == r[j].cpu && ids[k] == r[j].id) seen = true;
                }
                if (seen) continue;
                (cpus[n], ids[n], hashes[n]) = (r[j].cpu, r[j].id, keccak256(ITapeOutProcessor(r[j].cpu).netlist(r[j].id)));
                n++;
            }
        }
        bytes memory packed;
        for (uint256 k = 1; k < n; k++) {
            packed = abi.encodePacked(packed, cpus[k], ids[k], hashes[k]);
        }
        address impl = IBeacon(ITapeOutFactory(TAPEOUT).circuitBeacon()).implementation();
        return keccak256(
            abi.encode(PinRegistry.Kind.Circuit, block.chainid, cpu, id, hashes[0], keccak256(packed), schemaHash, cert, impl)
        );
    }

    function _cert(string memory file) internal view returns (bytes32) {
        return vm.parseJsonBytes32(vm.readFile(string.concat("sdk/quotes/", file, ".json")), ".certificateHash");
    }

    function _layout(address cpu, uint256 id, Schema.Field[] memory fields) internal view returns (Schema.Layout memory l) {
        (uint32 nIn,,,) = ITapeOutProcessor(cpu).circuitInfo(id);
        l = Schema.Layout(keccak256(ITapeOutProcessor(cpu).netlist(id)), nIn, fields);
    }

    /// @dev Pins (unless already pinned) and lists (unless already listed, or `listing` is empty).
    function _seed(
        string memory key,
        string memory listing,
        address cpu,
        uint256 id,
        Schema.Layout memory l,
        string memory certFile,
        Catalog.Vector[] memory v
    ) internal returns (bytes32 pinId) {
        bytes32 schemaHash = Schema.hash(l);
        bytes32 cert = _cert(certFile);
        pinId = _previewPinId(cpu, id, schemaHash, cert);
        if (reg.kindOf(pinId) == PinRegistry.Kind.None) {
            bytes32 got = reg.pin(cpu, id, schemaHash, cert);
            require(got == pinId, "pin id preview mismatch");
            console2.log("pinned", key);
        } else {
            console2.log("pin exists", key);
        }
        if (bytes(listing).length != 0) {
            if (catalog.entryOf(pinId).lister == address(0)) {
                catalog.list(Catalog.Manifest(pinId, listing, schemaHash, v, deployer, 0, ""));
                console2.log("listed", key);
            } else {
                console2.log("listing exists", key);
            }
        }
        seedKeys.push(key);
        seedPins.push(pinId);
    }

    function _f(Schema.Kind k, uint32 off, uint32 w, uint256 val) internal pure returns (Schema.Field memory) {
        return Schema.Field(k, off, w, val);
    }

    function _two(Schema.Field memory a, Schema.Field memory b) internal pure returns (Schema.Field[] memory f) {
        f = new Schema.Field[](2);
        (f[0], f[1]) = (a, b);
    }

    function _v(bytes memory input, bytes memory out) internal pure returns (Catalog.Vector memory) {
        return Catalog.Vector(input, out, "");
    }

    function _seeds() internal {
        Schema.Field memory boolA = _f(Schema.Kind.Bool, 0, 1, 0);
        Schema.Field memory flagB = _f(Schema.Kind.Flag, 1, 1, 1);
        Catalog.Vector[] memory v;

        // 1. Stablecoin Transfer Limit (NAND 0x839b #2)
        Schema.Layout memory l = _layout(0x839bdD6fa7A66416A609A735e11DE5411B98574e, 2, _two(boolA, flagB));
        nandLayout.netlistHash = l.netlistHash;
        nandLayout.nIn = l.nIn;
        nandLayout.fields.push(boolA);
        nandLayout.fields.push(flagB);
        v = new Catalog.Vector[](2);
        (v[0], v[1]) = (_v(hex"02", hex"01"), _v(hex"03", hex"00"));
        nandPin = _seed(
            "stablecoinTransferLimit",
            "Stablecoin Transfer Limit: allows a transfer only when its amount is at most the cap set for the account.",
            0x839bdD6fa7A66416A609A735e11DE5411B98574e, 2, l, "nand-839bdd-2", v
        );

        // 2. Numeric Transaction Limit (16-bit comparator 0xF9bB #7)
        l = _layout(0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F, 7, _two(_f(Schema.Kind.Uint, 0, 16, 0), _f(Schema.Kind.Uint, 16, 16, 0)));
        v = new Catalog.Vector[](3);
        (v[0], v[1], v[2]) = (_v(hex"ae019001", hex"01"), _v(hex"9001ae01", hex"00"), _v(hex"90019001", hex"01"));
        _seed(
            "numericTransactionLimit",
            "Numeric Transaction Limit: allows a transaction only when a value is at or below a fixed limit.",
            0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F, 7, l, "comparator-f9bbdc-7", v
        );

        // 3. Organization-Wide Policy Floor (team policy XOR 0xB04E #5, floor NAND 0xB04E #3 in its closure)
        address b04e = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;
        _seed("policyFloorCircuit", "", b04e, 3, _layout(b04e, 3, _two(boolA, flagB)), "nand-floor-b04eb7-3", v);
        l = _layout(b04e, 5, _two(boolA, flagB));
        v = new Catalog.Vector[](2);
        (v[0], v[1]) = (_v(hex"02", hex"01"), _v(hex"03", hex"00"));
        _seed(
            "organizationWidePolicyFloor",
            "Organization-Wide Policy Floor: a team policy that must also satisfy an organization's minimum rule; both must allow.",
            b04e, 5, l, "xor-b04eb7-5", v
        );

        // 4. Periodic Spending Budget (stateful toggle 0xE2a6 #18, run by Tick)
        Schema.Field[] memory one = new Schema.Field[](1);
        one[0] = _f(Schema.Kind.Flag, 0, 1, 1);
        l = _layout(0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7, 18, one);
        v = new Catalog.Vector[](2);
        v[0] = Catalog.Vector(hex"01", hex"01", hex"00"); // first spend in a period
        v[1] = Catalog.Vector(hex"01", hex"00", hex"01"); // second spend in the same period
        _seed(
            "periodicSpendingBudget",
            "Periodic Spending Budget: allows one spend per period; the budget resets at the start of each period.",
            0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7, 18, l, "toggle-e2a6c6-18", v
        );

        // 5. Protected Swap Policy (NOR 0x87BF #52)
        l = _layout(0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6, 52, _two(boolA, _f(Schema.Kind.Bool, 1, 1, 0)));
        v = new Catalog.Vector[](4);
        (v[0], v[1], v[2], v[3]) = (_v(hex"00", hex"01"), _v(hex"01", hex"00"), _v(hex"02", hex"00"), _v(hex"03", hex"00"));
        _seed(
            "protectedSwapPolicy",
            "Protected Swap Policy: allows a swap only when the amount is within the cap and the proceeds return to the account.",
            0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6, 52, l, "nor-87bfca-52", v
        );

        // Sample vault: deposits only from Safes bound to the Stablecoin Transfer Limit with 1 day of notice.
        vault = BoundVault(_d("BoundVault", type(BoundVault).creationCode, abi.encode(binding, binding.policyHashOf(nandPin), uint256(1 days))));
    }

    // ================================================================== demo Safe

    /// @dev A Safe 1.5.0 owned by the deployer (threshold 1) with salt "fengce.<tag>.<VERSION>".
    function _safeInit(string memory tag) internal view returns (bytes memory init, uint256 saltNonce, address predicted) {
        address[] memory owners = new address[](1);
        owners[0] = deployer;
        init = abi.encodeCall(ISafe.setup, (owners, 1, address(0), "", FALLBACK, address(0), 0, payable(address(0))));
        saltNonce = uint256(keccak256(abi.encodePacked("fengce.", tag, ".", VERSION)));
        bytes32 salt = keccak256(abi.encodePacked(keccak256(init), saltNonce));
        bytes memory code = abi.encodePacked(IProxyFactoryLive(SAFE_FACTORY).proxyCreationCode(), uint256(uint160(SAFE_L2)));
        predicted = vm.computeCreate2Address(salt, keccak256(code), SAFE_FACTORY);
    }

    /// @dev Creates the Safe unless it already exists; returns its address.
    function _ensureSafe(string memory tag) internal returns (address safe) {
        (bytes memory init, uint256 saltNonce, address predicted) = _safeInit(tag);
        if (predicted.code.length == 0) {
            safe = IProxyFactoryLive(SAFE_FACTORY).createProxyWithNonce(SAFE_L2, init, saltNonce);
            require(safe == predicted, string.concat("Safe address mismatch: ", tag));
            console2.log("created Safe", tag, safe);
        } else {
            console2.log("Safe exists", tag, predicted);
        }
        return predicted;
    }

    function _exec(address to, bytes memory data) internal {
        bytes memory sig = abi.encodePacked(uint256(uint160(deployer)), uint256(0), uint8(1));
        require(ISafe(payable(demoSafe)).execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig));
    }

    function _slot(bytes32 s) internal view returns (address) {
        return abi.decode(ISafe(payable(demoSafe)).getStorageAt(uint256(s), 1), (address));
    }

    function _demo() internal {
        (,, address predicted) = _safeInit("demo");
        if (predicted.code.length == 0 && IERC20Live(USDT0).balanceOf(deployer) < DEMO_FUNDING) {
            console2.log("Deployer holds less than 2 USDT0 and no demo Safe exists: demo skipped");
            return;
        }
        demoSafe = _ensureSafe("demo");
        (bool configured,,,,,,) = guard.configOf(demoSafe);
        bool guarded = _slot(GUARD_SLOT) == address(guard);

        if (!guard.allowlisted(demoSafe, address(agentExec), AgentExecutor.addAgent.selector)) {
            require(!configured, "allowlist missing on a configured Safe: needs the admin timelock");
            _exec(address(guard), abi.encodeCall(FengceGuard.setAllowlisted, (address(agentExec), AgentExecutor.addAgent.selector, true)));
        }
        if (!configured) {
            TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
            b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, DEMO_CAP);
            address[] memory tokens = new address[](1);
            tokens[0] = USDT0;
            FengceGuard.ConfigInput memory c;
            (c.pinId, c.layout, c.bindings) = (nandPin, nandLayout, b);
            (c.recoveryDelay, c.recoveryWindow, c.adminDelay) = (2 days, 2 days, 1 days);
            c.preflightTokens = tokens;
            _exec(address(guard), abi.encodeCall(FengceGuard.configure, (c)));
        }
        if (!ISafe(payable(demoSafe)).isModuleEnabled(address(agentExec))) {
            require(!guarded, "module missing on a guarded Safe: needs the admin timelock");
            _exec(demoSafe, abi.encodeWithSignature("enableModule(address)", address(agentExec)));
        }
        if (!guarded) _exec(demoSafe, abi.encodeWithSignature("setGuard(address)", address(guard)));
        if (_slot(MODULE_GUARD_SLOT) != address(guard)) {
            _exec(demoSafe, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
        }
        if (demoAgent != address(0)) {
            (bool active,) = agentExec.agents(demoSafe, demoAgent);
            if (!active) _exec(address(agentExec), abi.encodeCall(AgentExecutor.addAgent, (demoAgent, 0)));
        }
        if (IERC20Live(USDT0).balanceOf(demoSafe) == 0 && IERC20Live(USDT0).balanceOf(deployer) >= DEMO_FUNDING) {
            require(IERC20Live(USDT0).transfer(demoSafe, DEMO_FUNDING));
        }
        console2.log("demo Safe", demoSafe);
    }

    // ================================================================== output

    function _writeAddresses() internal {
        string memory c = "addr.contracts";
        string memory contractsJson;
        for (uint256 i; i < recs.length; i++) {
            contractsJson = vm.serializeAddress(c, recs[i].name, recs[i].addr);
        }
        string memory pins = "addr.pins";
        string memory pinsJson;
        for (uint256 i; i < seedKeys.length; i++) {
            pinsJson = vm.serializeBytes32(pins, seedKeys[i], seedPins[i]);
        }
        string memory root = "addr";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "version", VERSION);
        vm.serializeString(root, "status", _status());
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "demoSafe", demoSafe);
        vm.serializeAddress(root, "demoAgent", demoAgent);
        vm.serializeAddress(root, "treasurySafe", treasury);
        vm.serializeString(root, "pins", pinsJson);
        string memory out = vm.serializeString(root, "contracts", contractsJson);
        vm.writeJson(out, "deployments/xlayer-196.json");
    }

    function _status() internal view returns (string memory) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulated (not deployed)";
    }

    /// @dev Compiler metadata of the artifact whose creation code produced `r.initCodeHash`.
    function _artifact(Rec memory r) internal view returns (string memory path, string memory metadata) {
        string[2] memory paths =
            [string.concat("out/", r.name, ".sol/", r.name, ".ir.json"), string.concat("out/", r.name, ".sol/", r.name, ".json")];
        for (uint256 i; i < 2; i++) {
            if (!vm.exists(paths[i])) continue;
            string memory json = vm.readFile(paths[i]);
            if (keccak256(abi.encodePacked(vm.parseJsonBytes(json, ".bytecode.object"), r.args)) == r.initCodeHash) {
                return (paths[i], vm.parseJsonString(json, ".rawMetadata"));
            }
        }
        // No artifact on disk matches (stale incremental build): record the settings the script compiled with.
        return (
            "no matching artifact on disk (run forge build --force first)",
            '{"compiler":{"version":"0.8.28"},"settings":{"viaIR":true,"optimizer":{"enabled":true,"runs":200},"evmVersion":"cancun"},"note":"init code from the DeployLive via_ir compilation unit; see initCodeHash"}'
        );
    }

    function _contractEntry(Rec memory r) internal returns (string memory) {
        string memory k = string.concat("m.c.", r.name);
        (string memory path, string memory metadata) = _artifact(r);
        vm.serializeAddress(k, "address", r.addr);
        vm.serializeBytes32(k, "salt", r.salt);
        vm.serializeString(k, "saltPreimage", string.concat("fengce.", r.name, ".", VERSION));
        vm.serializeBytes32(k, "initCodeHash", r.initCodeHash);
        vm.serializeBytes(k, "constructorArgs", r.args);
        vm.serializeBytes32(k, "runtimeCodehash", r.addr.codehash);
        vm.serializeUint(k, "runtimeSize", r.addr.code.length);
        vm.serializeString(k, "artifact", path);
        return vm.serializeString(k, "compilerMetadata", metadata);
    }

    function _circuitEntry(string memory key, bytes32 pinId) internal returns (string memory) {
        string memory k = string.concat("m.p.", key);
        PinRegistry.CircuitPin memory p = reg.circuitPin(pinId);
        Catalog.Entry memory e = catalog.entryOf(pinId);
        vm.serializeBytes32(k, "pinId", pinId);
        vm.serializeAddress(k, "processor", p.processor);
        vm.serializeUint(k, "circuitId", p.circuitId);
        vm.serializeUint(k, "nIn", p.nIn);
        vm.serializeUint(k, "nOut", p.nOut);
        vm.serializeUint(k, "nState", p.nState);
        vm.serializeUint(k, "gateCount", p.gateCount);
        vm.serializeBytes32(k, "netlistHash", p.netlistHash);
        vm.serializeBytes32(k, "refClosureHash", p.refClosureHash);
        vm.serializeAddress(k, "closureProcessors", p.processors);
        vm.serializeBytes32(k, "schemaHash", p.schemaHash);
        vm.serializeBytes32(k, "certificateHash", p.certificateHash);
        vm.serializeAddress(k, "circuitImplementation", p.implementation);
        vm.serializeBool(k, "listed", e.lister != address(0));
        vm.serializeString(k, "catalogTier", e.lister == address(0) ? "" : ["Green", "Amber", "Red"][uint8(e.tier)]);
        vm.serializeUint(k, "catalogEvalGas", e.measuredGas);
        return vm.serializeString(k, "description", e.description);
    }

    function _rolesEntry() internal returns (string memory) {
        string memory k = "m.roles";
        vm.serializeString(k, "PinRegistry", "none (permissionless, pins are content-addressed)");
        vm.serializeString(k, "FengceGuard", "none global; each Safe configures itself (free until first configuration, then admin timelock); recovery needs all owners");
        vm.serializeUint(k, "FengceGuard.MIN_ADMIN_DELAY", guard.MIN_ADMIN_DELAY());
        vm.serializeUint(k, "FengceGuard.MIN_RECOVERY_DELAY", guard.MIN_RECOVERY_DELAY());
        vm.serializeUint(k, "FengceGuard.MIN_RECOVERY_WINDOW", guard.MIN_RECOVERY_WINDOW());
        vm.serializeUint(k, "FengceGuard.DEFAULT_RECOVERY_WINDOW", guard.DEFAULT_RECOVERY_WINDOW());
        vm.serializeAddress(k, "FengceInspector.adapters", _adapters());
        vm.serializeAddress(k, "FengceBinding.guard", address(binding.guard()));
        vm.serializeAddress(k, "AgentExecutor.guard", agentExec.guard());
        vm.serializeAddress(k, "Catalog.treasury", catalog.treasury());
        vm.serializeString(k, "Catalog.treasuryIs", "treasury Safe 1.5.0 (salt fengce.treasury.<version>), owner deployer, threshold 1");
        vm.serializeAddress(k, "treasurySafe.owners", ISafe(payable(treasury)).getOwners());
        vm.serializeUint(k, "treasurySafe.threshold", ISafe(payable(treasury)).getThreshold());
        vm.serializeUint(k, "Catalog.DESIGNER_BPS", catalog.DESIGNER_BPS());
        vm.serializeAddress(k, "Catalog.seedListerAndDesigner", deployer);
        vm.serializeBytes32(k, "BoundVault.requiredPolicy", vault.requiredPolicy());
        vm.serializeUint(k, "BoundVault.minNotice", vault.minNotice());
        vm.serializeString(k, "FengceFloors", "per account: floor owner and delay set by the account (minimum 1 day); none set at deployment");
        vm.serializeString(k, "Tick", "per group: group admin; no groups at deployment");
        vm.serializeString(k, "FengceHook", "per account; uninstall delay 2 days (not enforced by Safe7579 on its own uninstall)");
        return vm.serializeString(k, "others", "PolicyEngine, FengceStrictHandler, FengceSignatureVerifier, decoders: no roles");
    }

    function _adapters() internal view returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (address(guard), address(hook));
        require(inspector.isAdapter(a[0]) && inspector.isAdapter(a[1]), "inspector adapters");
    }

    function _demoEntry() internal returns (string memory) {
        string memory k = "m.demo";
        if (demoSafe == address(0) || demoSafe.code.length == 0) return vm.serializeString(k, "status", "not created");
        ISafe s = ISafe(payable(demoSafe));
        (address[] memory modules,) = s.getModulesPaginated(address(1), 10);
        (bool set, bytes32 pinId, uint64 recoveryDelay, uint64 recoveryWindow, uint64 adminDelay,,) = guard.configOf(demoSafe);
        (bool agentActive,) = agentExec.agents(demoSafe, demoAgent);
        vm.serializeAddress(k, "safe", demoSafe);
        vm.serializeAddress(k, "owners", s.getOwners());
        vm.serializeUint(k, "threshold", s.getThreshold());
        vm.serializeAddress(k, "guard", _slot(GUARD_SLOT));
        vm.serializeAddress(k, "moduleGuard", _slot(MODULE_GUARD_SLOT));
        vm.serializeAddress(k, "modules", modules);
        vm.serializeBool(k, "configured", set);
        vm.serializeBytes32(k, "policyPin", pinId);
        vm.serializeUint(k, "usdt0Cap", DEMO_CAP);
        vm.serializeUint(k, "recoveryDelay", recoveryDelay);
        vm.serializeUint(k, "recoveryWindow", recoveryWindow);
        vm.serializeUint(k, "adminDelay", adminDelay);
        vm.serializeAddress(k, "agent", demoAgent);
        vm.serializeBool(k, "agentActive", agentActive);
        return vm.serializeUint(k, "usdt0Balance", IERC20Live(USDT0).balanceOf(demoSafe));
    }

    function _writeManifest() internal {
        string memory contractsKey = "m.contracts";
        string memory contractsJson;
        for (uint256 i; i < recs.length; i++) {
            contractsJson = vm.serializeString(contractsKey, recs[i].name, _contractEntry(recs[i]));
        }
        string memory circuitsKey = "m.circuits";
        string memory cJson;
        for (uint256 i; i < seedKeys.length; i++) {
            cJson = vm.serializeString(circuitsKey, seedKeys[i], _circuitEntry(seedKeys[i], seedPins[i]));
        }
        string memory comp = "m.compiler";
        vm.serializeString(comp, "solc", "0.8.28");
        vm.serializeString(comp, "evmVersion", "cancun");
        vm.serializeBool(comp, "optimizer", true);
        vm.serializeUint(comp, "optimizerRuns", 200);
        vm.serializeBool(comp, "viaIR", true);
        string memory compJson = vm.serializeString(
            comp,
            "note",
            "Every contract is deployed from DeployLive's init code, compiled with via_ir (the script imports FengceGuard, which foundry.toml compiles with via_ir). Each contract's compilerMetadata is the matching artifact's full solc metadata (settings, remappings, source hashes)."
        );
        string memory root = "m";
        vm.serializeString(root, "gitCommit", vm.envOr("GIT_COMMIT", string("unknown")));
        vm.serializeString(root, "status", _status());
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "block", block.number);
        vm.serializeString(root, "version", VERSION);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "create2Deployer", CREATE2);
        vm.serializeAddress(root, "tapeoutFactory", TAPEOUT);
        vm.serializeString(root, "compiler", compJson);
        vm.serializeString(root, "contracts", contractsJson);
        vm.serializeString(root, "circuits", cJson);
        vm.serializeString(root, "roles", _rolesEntry());
        string memory out = vm.serializeString(root, "demo", _demoEntry());
        vm.writeJson(out, "deployments/manifest-xlayer-196.json");
    }
}
