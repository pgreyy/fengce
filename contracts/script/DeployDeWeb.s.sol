// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

interface ITransistors {
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function mint(uint256 id, uint256 amount) external payable;
}

interface IProcessor {
    function transistors() external view returns (address);
    function TAPEOUT_FEE() external view returns (uint256);
    function nextId() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function netlist(uint256 id) external view returns (bytes memory);
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256);
}

interface IOpener {
    function FEE() external view returns (uint256);
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function open(address circuits, uint256 tokenId) external payable;
}

interface ISiteRegistry {
    function isOpenedContainer(address container) external view returns (bool);
    function fileInfo(address container, string calldata path)
        external
        view
        returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
    function putFile(address container, string calldata path, string calldata contentType, bytes32 sha256Hash, bytes calldata data)
        external;
    function appendChunk(address container, string calldata path, uint256 expectIndex, bytes calldata data) external;
    function removeFile(address container, string calldata path) external;
    function setFallback(address container, string calldata path) external;
    function fallbackPath(address container) external view returns (string memory);
    function pathCount(address container) external view returns (uint256);
    function pathsRange(address container, uint256 from, uint256 n) external view returns (string[] memory);
}

interface IDomainBinding {
    function monthlyFee() external view returns (uint256);
    function isLive(string calldata name, address container) external view returns (bool);
    function isContainerLive(address container) external view returns (bool);
    function bind(string calldata name, address container, uint256 months) external payable;
}

/// @notice Publishes the static app build (app/dist) on TapeOut DeWeb on X Layer, the cheapest way (TAP-10):
/// one NAND transistor on processor #180 (mint price 0), a one-gate circuit taped out on it, its container opened,
/// every file uploaded to SiteRegistry in 24,000-byte chunks with its SHA-256, index.html as fallback, and the
/// on-chain name <#ID>.2.180.tape paid on DomainBinding.
///
/// Resumable: every step checks the chain first. Run 1 mints and tapes out (the new circuit's #ID is only known once
/// that transaction is mined) and stops; run 2 finds the circuit (owned by the sender, with this exact netlist),
/// then opens, uploads only files that are missing, partial or changed, removes on-chain files no longer in the build,
/// sets the fallback and binds the name. Running it again after that changes nothing unless app/dist changed.
///   forge script script/DeployDeWeb.s.sol --rpc-url xlayer --account fengce-deployer --sender <deployer> --broadcast --slow
/// Writes deployments/deweb-xlayer-196.json.
contract DeployDeWeb is Script {
    uint256 constant CPU_NUMBER = 180;
    IProcessor constant CPU = IProcessor(0x7335a50819d44402e3D5E00239bBB80A13E7308F);
    IOpener constant OPENER = IOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    IDomainBinding constant BINDING = IDomainBinding(0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9);
    uint256 constant NAND = 0;
    uint256 constant CHUNK = 24_000;
    uint256 constant AREA_XLAYER = 2;
    string constant DIST = "../app/dist";
    /// One NAND gate of inputs 0 and 1 (signals 2 and 3), TAP-02 record 0x00 | u24 a | u24 b.
    bytes constant NETLIST = hex"00000002000003";

    address sender;
    uint256 id;
    address container;
    string name;
    string filesJson;
    uint256 uploadedChunks;

    function run() external {
        require(block.chainid == 196, "X Layer mainnet only");
        sender = msg.sender;
        id = _findCircuit();
        vm.startBroadcast();
        if (id == 0) {
            _tapeout();
            vm.stopBroadcast();
            console2.log("Circuit taped out. Run the same command again to open the container, upload and bind.");
            return;
        }
        container = OPENER.accountOf(address(CPU), id);
        name = string.concat(vm.toString(id), ".", vm.toString(AREA_XLAYER), ".", vm.toString(CPU_NUMBER), ".tape");
        console2.log("circuit #", id);
        console2.log("container", container);
        console2.log("name", name);
        if (!SITES.isOpenedContainer(container)) {
            uint256 fee = OPENER.FEE();
            console2.log("opening container, fee (wei)", fee);
            OPENER.open{value: fee}(address(CPU), id);
        }
        string[] memory paths = _upload();
        _prune(paths);
        if (keccak256(bytes(SITES.fallbackPath(container))) != keccak256("index.html")) SITES.setFallback(container, "index.html");
        if (!BINDING.isLive(name, container)) {
            uint256 monthly = BINDING.monthlyFee();
            uint256 months = monthly == 0 ? 120 : 1;
            console2.log("binding name; monthly fee (wei), months:", monthly, months);
            BINDING.bind{value: monthly * months}(name, container, months);
        }
        vm.stopBroadcast();
        console2.log("chunks uploaded in this run", uploadedChunks);
        _write(paths);
    }

    /// The sender's circuit on processor #180 with exactly NETLIST, or 0.
    function _findCircuit() internal view returns (uint256) {
        uint256 last = CPU.nextId(); // the highest #ID minted so far
        for (uint256 i = last; i >= 1; i--) {
            try CPU.ownerOf(i) returns (address o) {
                if (o == sender && keccak256(CPU.netlist(i)) == keccak256(NETLIST)) return i;
            } catch {}
        }
        return 0;
    }

    function _tapeout() internal {
        ITransistors t = ITransistors(CPU.transistors());
        if (t.balanceOf(sender, NAND) == 0) {
            uint256 value = t.mintPrice() + t.protocolFee();
            console2.log("minting 1 NAND transistor, value (wei)", value);
            t.mint{value: value}(NAND, 1);
        }
        uint256 fee = CPU.TAPEOUT_FEE();
        console2.log("taping out a one-NAND circuit, fee (wei)", fee);
        CPU.tapeout{value: fee}(NETLIST, 2, 1);
    }

    function _contentType(string memory path) internal pure returns (string memory) {
        bytes memory p = bytes(path);
        if (_endsWith(p, ".html")) return "text/html; charset=utf-8";
        if (_endsWith(p, ".js")) return "text/javascript; charset=utf-8";
        if (_endsWith(p, ".css")) return "text/css; charset=utf-8";
        if (_endsWith(p, ".json")) return "application/json";
        if (_endsWith(p, ".woff2")) return "font/woff2";
        if (_endsWith(p, ".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    function _endsWith(bytes memory s, string memory suffix) internal pure returns (bool) {
        bytes memory x = bytes(suffix);
        if (s.length < x.length) return false;
        for (uint256 i; i < x.length; i++) {
            if (s[s.length - x.length + i] != x[i]) return false;
        }
        return true;
    }

    function _slice(bytes memory data, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        out = new bytes(to - from);
        assembly ("memory-safe") {
            mcopy(add(out, 32), add(add(data, 32), from), sub(to, from))
        }
    }

    /// Uploads every file of app/dist that is missing, partial or different on chain. Returns the site paths.
    function _upload() internal returns (string[] memory paths) {
        VmSafe.DirEntry[] memory entries = vm.readDir(DIST, 4);
        uint256 n;
        for (uint256 i; i < entries.length; i++) {
            if (!entries[i].isDir) n++;
        }
        paths = new string[](n);
        uint256 k;
        bytes memory prefix = bytes(string.concat(vm.projectRoot(), "/", DIST, "/"));
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].isDir) continue;
            bytes memory full = bytes(entries[i].path);
            uint256 cut = _startsWith(full, prefix) ? prefix.length : bytes(string.concat(DIST, "/")).length;
            string memory path = string(_slice(full, cut, full.length));
            paths[k++] = path;
            _uploadFile(path, vm.readFileBinary(entries[i].path));
        }
    }

    function _startsWith(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (s.length < p.length) return false;
        for (uint256 i; i < p.length; i++) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }

    function _uploadFile(string memory path, bytes memory data) internal {
        bytes32 hash = sha256(data);
        uint256 chunks = (data.length + CHUNK - 1) / CHUNK;
        (,, bytes32 onchain,, uint256 have) = SITES.fileInfo(container, path);
        uint256 start;
        if (onchain == hash && have == chunks) return; // already complete
        if (onchain == hash && have > 0 && have < chunks) {
            start = have; // resume a partial upload
        } else {
            uint256 end = data.length < CHUNK ? data.length : CHUNK;
            SITES.putFile(container, path, _contentType(path), hash, _slice(data, 0, end));
            uploadedChunks++;
            start = 1;
        }
        for (uint256 c = start; c < chunks; c++) {
            uint256 from = c * CHUNK;
            uint256 to = from + CHUNK < data.length ? from + CHUNK : data.length;
            SITES.appendChunk(container, path, c, _slice(data, from, to));
            uploadedChunks++;
        }
        console2.log("uploaded", path, data.length);
    }

    /// Removes on-chain files that are no longer part of the build (old hashed asset names).
    function _prune(string[] memory paths) internal {
        uint256 count = SITES.pathCount(container);
        if (count == 0) return;
        string[] memory onchain = SITES.pathsRange(container, 0, count);
        for (uint256 i; i < onchain.length; i++) {
            bool keep;
            for (uint256 j; j < paths.length; j++) {
                if (keccak256(bytes(paths[j])) == keccak256(bytes(onchain[i]))) {
                    keep = true;
                    break;
                }
            }
            if (!keep) {
                console2.log("removing", onchain[i]);
                SITES.removeFile(container, onchain[i]);
            }
        }
    }

    function _write(string[] memory paths) internal {
        string memory f = "files";
        for (uint256 i; i < paths.length; i++) {
            (uint32 size,, bytes32 hash,, uint256 chunks) = SITES.fileInfo(container, paths[i]);
            string memory k = string.concat("file.", paths[i]);
            vm.serializeUint(k, "size", size);
            vm.serializeUint(k, "chunks", chunks);
            filesJson = vm.serializeString(f, paths[i], vm.serializeBytes32(k, "sha256", hash));
        }
        string memory root = "deweb";
        vm.serializeString(root, "status", vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) ? "broadcast" : "simulated (not published)");
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "block", block.number);
        vm.serializeAddress(root, "processor", address(CPU));
        vm.serializeUint(root, "processorNumber", CPU_NUMBER);
        vm.serializeUint(root, "circuitId", id);
        vm.serializeAddress(root, "container", container);
        vm.serializeString(root, "name", name);
        vm.serializeString(root, "url", string.concat("tape://", name, "/"));
        vm.serializeAddress(root, "siteRegistry", address(SITES));
        vm.serializeAddress(root, "domainBinding", address(BINDING));
        vm.serializeBool(root, "nameLive", BINDING.isLive(name, container));
        string memory out = vm.serializeString(root, "files", filesJson);
        vm.writeJson(out, "../deployments/deweb-xlayer-196.json");
    }
}
