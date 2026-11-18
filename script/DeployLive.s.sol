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
import {Tick} from "../src/core/Tick.sol";
import {Catalog} from "../src/core/Catalog.sol";
import {FengceFloors} from "../src/core/FengceFloors.sol";
import {ITapeOutFactory, ITapeOutProcessor} from "../src/core/interfaces/ITapeOut.sol";
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
}

interface IERC20Live {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

/// @notice Live deployment of Fengce on X Layer mainnet (chain 196), in one broadcast run:
///   forge script script/DeployLive.s.sol --rpc-url xlayer --account fengce-deployer --sender <deployer> --broadcast
/// Without --broadcast it only simulates. Every contract goes through the CREATE2 deployer (contracts already
/// at their address are skipped); then 5 seed policies are pinned and listed in the Catalog with test vectors
/// that the Catalog runs on-chain; then, if the deployer holds at least 2 USDT0, a demo Safe is created and
/// protected (FengceGuard as both guards, USDT0 cap 1), a demo agent is registered, and the Safe gets 2 USDT0.
/// Addresses are written to deployments/xlayer-196.json. Run once: pins and listings are not idempotent.
/// Env: DEMO_AGENT (agent address, optional).
contract DeployLive is Script {
    address constant CREATE2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant TAPEOUT = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address constant NAND_CPU = 0x839bdD6fa7A66416A609A735e11DE5411B98574e;
    address constant CMP_CPU = 0xF9bBdc7f678eb3A49D338ffAcDaaD9339de50a0F;
    address constant B04E = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;
    address constant TOGGLE_CPU = 0xE2a6c6393b5A8B99cb481035eB8e244C66641cd7;
    address constant NOR_CPU = 0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6;
    address constant SAFE_FACTORY = 0x14F2982D601c9458F93bd70B218933A6f8165e7b;
    address constant SAFE_L2 = 0xEdd160fEBBD92E350D4D398fb636302fccd67C7e;
    address constant FALLBACK = 0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    uint256 constant CAP = 2_000_000;
    string constant VERSION = "v0.2.0";

    address deployer;
    PinRegistry reg;
    FengceGuard guard;
    FengceHook hook;
    FengceInspector inspector;
    Catalog catalog;
    AgentExecutor agentExec;
    FengceBinding binding;
    address[] deployed;
    string[] names;
    bytes32 nandPin;
    Schema.Layout nandLayout;
    address demoSafe;
    bool demoFunded;

    function run() external {
        require(block.chainid == 196, "X Layer mainnet only");
        deployer = msg.sender;
        vm.startBroadcast();
        _deployAll();
        _seedPolicies();
        _demo(vm.envOr("DEMO_AGENT", address(0)));
        vm.stopBroadcast();
        _write();
    }

    // ------------------------------------------------------------------ contracts

    function _d(string memory name, bytes memory initCode) internal returns (address a) {
        bytes32 salt = keccak256(abi.encodePacked("fengce.", name, ".", VERSION));
        a = vm.computeCreate2Address(salt, keccak256(initCode), CREATE2);
        if (a.code.length == 0) {
            (bool ok,) = CREATE2.call(abi.encodePacked(salt, initCode));
            require(ok && a.code.length > 0, string.concat("deploy failed: ", name));
        }
        deployed.push(a);
        names.push(name);
        console2.log(name, a);
    }

    function _deployAll() internal {
        reg = PinRegistry(_d("PinRegistry", abi.encodePacked(type(PinRegistry).creationCode, abi.encode(TAPEOUT))));
        _d("PolicyEngine", abi.encodePacked(type(PolicyEngine).creationCode, abi.encode(reg, CAP)));
        guard = FengceGuard(_d("FengceGuard", abi.encodePacked(type(FengceGuard).creationCode, abi.encode(reg, CAP))));
        hook = FengceHook(_d("FengceHook", abi.encodePacked(type(FengceHook).creationCode, abi.encode(reg, CAP))));
        address[] memory adapters = new address[](2);
        (adapters[0], adapters[1]) = (address(guard), address(hook));
        inspector = FengceInspector(_d("FengceInspector", abi.encodePacked(type(FengceInspector).creationCode, abi.encode(adapters))));
        _d("FengceFloors", abi.encodePacked(type(FengceFloors).creationCode, abi.encode(reg, CAP)));
        binding = FengceBinding(_d("FengceBinding", abi.encodePacked(type(FengceBinding).creationCode, abi.encode(guard))));
        _d("FengceSignatureVerifier", abi.encodePacked(type(FengceSignatureVerifier).creationCode, abi.encode(guard)));
        _d("FengceStrictHandler", type(FengceStrictHandler).creationCode);
        agentExec = AgentExecutor(_d("AgentExecutor", abi.encodePacked(type(AgentExecutor).creationCode, abi.encode(guard))));
        _d("Tick", abi.encodePacked(type(Tick).creationCode, abi.encode(reg, uint256(1_000_000))));
        catalog = Catalog(_d("Catalog", abi.encodePacked(type(Catalog).creationCode, abi.encode(reg, CAP, deployer))));
        _d("UniswapV3RouterDecoder", type(UniswapV3RouterDecoder).creationCode);
        _d("UniswapV2RouterDecoder", type(UniswapV2RouterDecoder).creationCode);
        _d("AaveV3PoolDecoder", type(AaveV3PoolDecoder).creationCode);
    }

    // ------------------------------------------------------------------ seed policies

    function _layout(address cpu, uint256 id, Schema.Field[] memory fields) internal view returns (Schema.Layout memory l) {
        (uint32 nIn,,,) = ITapeOutProcessor(cpu).circuitInfo(id);
        l = Schema.Layout(keccak256(ITapeOutProcessor(cpu).netlist(id)), nIn, fields);
    }

    function _f(Schema.Kind k, uint32 off, uint32 w, uint256 v) internal pure returns (Schema.Field memory) {
        return Schema.Field(k, off, w, v);
    }

    function _two(Schema.Field memory a, Schema.Field memory b) internal pure returns (Schema.Field[] memory f) {
        f = new Schema.Field[](2);
        (f[0], f[1]) = (a, b);
    }

    function _list(bytes32 pinId, Schema.Layout memory l, string memory description, Catalog.Vector[] memory v) internal {
        catalog.list(Catalog.Manifest(pinId, description, Schema.hash(l), v, deployer, 0, ""));
    }

    function _v(bytes memory input, bytes memory out) internal pure returns (Catalog.Vector memory) {
        return Catalog.Vector(input, out, "");
    }

    function _seedPolicies() internal {
        if (catalog.count() != 0) {
            console2.log("Catalog already has entries; seeding skipped");
            return;
        }
        Schema.Field memory boolA = _f(Schema.Kind.Bool, 0, 1, 0);
        Schema.Field memory flagB = _f(Schema.Kind.Flag, 1, 1, 1);

        // 1. NAND transfer cap (with the Quote certificate from sdk/quotes/nand-839bdd-2.json)
        Schema.Layout memory l = _layout(NAND_CPU, 2, _two(boolA, flagB));
        nandLayout.netlistHash = l.netlistHash;
        nandLayout.nIn = l.nIn;
        nandLayout.fields.push(boolA);
        nandLayout.fields.push(flagB);
        bytes32 cert = vm.parseJsonBytes32(vm.readFile("sdk/quotes/nand-839bdd-2.json"), ".certificateHash");
        nandPin = reg.pin(NAND_CPU, 2, Schema.hash(l), cert);
        Catalog.Vector[] memory v = new Catalog.Vector[](2);
        (v[0], v[1]) = (_v(hex"02", hex"01"), _v(hex"03", hex"00"));
        _list(nandPin, l, "Transfer cap: allows a transaction when its amount is at most the cap. Input a = amount above the cap, input b = 1; NAND(a, 1).", v);

        // 2. 16-bit comparator cap
        l = _layout(CMP_CPU, 7, _two(_f(Schema.Kind.Uint, 0, 16, 0), _f(Schema.Kind.Uint, 16, 16, 0)));
        bytes32 p = reg.pin(CMP_CPU, 7, Schema.hash(l), bytes32(0));
        v = new Catalog.Vector[](3);
        (v[0], v[1], v[2]) = (_v(hex"ae019001", hex"01"), _v(hex"9001ae01", hex"00"), _v(hex"90019001", hex"01"));
        _list(p, l, "16-bit comparator cap: 1 when a >= b (a = inputs 0-15, b = inputs 16-31). Bind a to a limit and b to the amount.", v);

        // 3. REF-built XOR with a NAND floor (floor = 0xB04E #3, which is in #5's closure)
        Schema.Layout memory floorL = _layout(B04E, 3, _two(boolA, flagB));
        reg.pin(B04E, 3, Schema.hash(floorL), bytes32(0));
        l = _layout(B04E, 5, _two(boolA, flagB));
        p = reg.pin(B04E, 5, Schema.hash(l), bytes32(0));
        v = new Catalog.Vector[](2);
        (v[0], v[1]) = (_v(hex"02", hex"01"), _v(hex"03", hex"00"));
        _list(p, l, "Team cap with a floor: XOR built by REF from AND, OR and NAND circuits; use with FengceFloors and the NAND circuit 0xB04E #3 as the floor (floor AND policy).", v);

        // 4. Tick stateful period cap (toggle: new state = state XOR spend)
        Schema.Field[] memory one = new Schema.Field[](1);
        one[0] = _f(Schema.Kind.Flag, 0, 1, 1);
        l = _layout(TOGGLE_CPU, 18, one);
        p = reg.pin(TOGGLE_CPU, 18, Schema.hash(l), bytes32(0));
        v = new Catalog.Vector[](2);
        v[0] = Catalog.Vector(hex"01", hex"01", hex"00"); // first spend in a period: allowed
        v[1] = Catalog.Vector(hex"01", hex"00", hex"01"); // second spend: denied
        _list(p, l, "One spend per period: stateful toggle evaluated by Tick; state resets to zero each period.", v);

        // 5. NOR swap rule
        l = _layout(NOR_CPU, 52, _two(boolA, _f(Schema.Kind.Bool, 1, 1, 0)));
        p = reg.pin(NOR_CPU, 52, Schema.hash(l), bytes32(0));
        v = new Catalog.Vector[](4);
        (v[0], v[1], v[2], v[3]) = (_v(hex"00", hex"01"), _v(hex"01", hex"00"), _v(hex"02", hex"00"), _v(hex"03", hex"00"));
        _list(p, l, "Swap rule: NOR(amount above cap, proceeds go elsewhere). Allows only capped swaps whose output returns to the account.", v);

        // Sample vault: deposits only from Safes bound to the NAND transfer cap with at least 1 day of notice.
        _d("BoundVault", abi.encodePacked(type(BoundVault).creationCode, abi.encode(binding, binding.policyHashOf(nandPin), uint256(1 days))));
    }

    // ------------------------------------------------------------------ demo Safe

    function _exec(address to, bytes memory data) internal {
        bytes memory sig = abi.encodePacked(uint256(uint160(deployer)), uint256(0), uint8(1));
        require(ISafe(payable(demoSafe)).execTransaction(to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig));
    }

    function _demo(address agent) internal {
        if (IERC20Live(USDT0).balanceOf(deployer) < 2_000_000) {
            console2.log("Deployer holds less than 2 USDT0: demo Safe skipped");
            return;
        }
        address[] memory owners = new address[](1);
        owners[0] = deployer;
        bytes memory init = abi.encodeCall(ISafe.setup, (owners, 1, address(0), "", FALLBACK, address(0), 0, payable(address(0))));
        uint256 saltNonce = uint256(keccak256(abi.encodePacked("fengce.demo.", VERSION)));
        demoSafe = IProxyFactoryLive(SAFE_FACTORY).createProxyWithNonce(SAFE_L2, init, saltNonce);

        TxFacts.Binding[] memory b = new TxFacts.Binding[](1);
        b[0] = TxFacts.Binding(TxFacts.Source.AmountGt, 1_000_000); // cap: 1 USDT0 (6 decimals)
        address[] memory tokens = new address[](1);
        tokens[0] = USDT0;
        FengceGuard.ConfigInput memory c;
        (c.pinId, c.layout, c.bindings) = (nandPin, nandLayout, b);
        (c.recoveryDelay, c.recoveryWindow, c.adminDelay) = (2 days, 2 days, 1 days);
        c.preflightTokens = tokens;

        _exec(address(guard), abi.encodeCall(FengceGuard.setAllowlisted, (address(agentExec), AgentExecutor.addAgent.selector, true)));
        _exec(address(guard), abi.encodeCall(FengceGuard.configure, (c)));
        _exec(demoSafe, abi.encodeWithSignature("enableModule(address)", address(agentExec)));
        _exec(demoSafe, abi.encodeWithSignature("setGuard(address)", address(guard)));
        _exec(demoSafe, abi.encodeWithSignature("setModuleGuard(address)", address(guard)));
        if (agent != address(0)) _exec(address(agentExec), abi.encodeCall(AgentExecutor.addAgent, (agent, 0)));
        require(IERC20Live(USDT0).transfer(demoSafe, 2_000_000));
        demoFunded = true;
        console2.log("demo Safe", demoSafe);
    }

    // ------------------------------------------------------------------ output

    function _write() internal {
        string memory c = "contracts";
        string memory contractsJson;
        for (uint256 i; i < deployed.length; i++) {
            contractsJson = vm.serializeAddress(c, names[i], deployed[i]);
        }
        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "version", VERSION);
        vm.serializeString(
            root, "status", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulated (not deployed)"
        );
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeAddress(root, "create2Deployer", CREATE2);
        vm.serializeBytes32(root, "nandPolicyPin", nandPin);
        vm.serializeAddress(root, "demoSafe", demoSafe);
        vm.serializeAddress(root, "demoAgent", vm.envOr("DEMO_AGENT", address(0)));
        vm.serializeBool(root, "demoFunded", demoFunded);
        string memory out = vm.serializeString(root, "contracts", contractsJson);
        vm.writeJson(out, "deployments/xlayer-196.json");
    }
}
