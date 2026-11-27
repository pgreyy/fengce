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
    /// PHASE: "assets" (content-hashed files under assets/: new names, so the live site keeps working while they upload),
    /// "final" (everything else, pages last; then prune, fallback and name), or "all" (default: one run does both).
    string phase;
    /// MAX_CHUNKS: at most this many chunks in this run (the rest continue in the next run; 0 = no limit).
    uint256 maxChunks;
    /// PLAN=1: count what is missing on chain and send nothing.
    bool plan;
    uint256 neededChunks;
    uint256 neededAssets;
    uint256 neededFinal;
    bool budgetHit;
    /// HOME_FILES (with PHASE=home): the assets dist/index.html loads, comma-separated; they go up first, then index.html.
    string homeFiles;

    function run() external {
        require(block.chainid == 196, "X Layer mainnet only");
        sender = msg.sender;
        phase = vm.envOr("PHASE", string("all"));
        maxChunks = vm.envOr("MAX_CHUNKS", uint256(0));
        plan = vm.envOr("PLAN", false);
        homeFiles = string.concat(",", vm.envOr("HOME_FILES", string("")), ",index.html,");
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
        bool finalStep = !plan && !budgetHit && neededChunks == 0 && _is(phase, "final") || (!plan && !budgetHit && neededChunks == 0 && _is(phase, "all"));
        if (finalStep) {
            // every file is complete on chain: only now remove files the build no longer has, and keep the name live
            _prune(paths);
            if (keccak256(bytes(SITES.fallbackPath(container))) != keccak256("index.html")) SITES.setFallback(container, "index.html");
            if (!BINDING.isLive(name, container)) {
                uint256 monthly = BINDING.monthlyFee();
                uint256 months = monthly == 0 ? 120 : 1;
                console2.log("binding name; monthly fee (wei), months:", monthly, months);
                BINDING.bind{value: monthly * months}(name, container, months);
            }
        }
        vm.stopBroadcast();
        console2.log("DEWEB chunksSent", uploadedChunks);
        console2.log("DEWEB remainingAssets", neededAssets);
        console2.log("DEWEB remainingFinal", neededFinal);
        console2.log("DEWEB done", finalStep ? 1 : 0);
        if (finalStep) _write(paths);
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
        string[] memory full = new string[](n);
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].isDir) continue;
            full[k] = entries[i].path;
            paths[k++] = _sitePath(bytes(entries[i].path));
        }
        if (plan) for (uint256 i; i < n && i < 4; i++) console2.log("DEWEB path", paths[i]);
        // pass 0: hashed assets; pass 1: data and other files; pass 2: pages (.html) last, so new pages only go live
        // once everything they load is on chain
        for (uint256 pass; pass < 3; pass++) {
            for (uint256 i; i < n; i++) {
                bool asset = _contains(bytes(paths[i]), "assets/");
                bool page = _endsWith(bytes(paths[i]), ".html");
                if ((pass == 0) != asset || (pass == 2) != (!asset && page)) continue;
                if (_is(phase, "home") && !_contains(bytes(homeFiles), bytes(string.concat(",", paths[i], ",")))) continue;
                _uploadFile(paths[i], vm.readFileBinary(full[i]), asset);
            }
        }
    }

    /// The site path of a file in app/dist: everything after the last "app/dist/" in the path readDir returns (forge may
    /// return it normalised or not). Refuses anything that would not be a clean relative path.
    function _sitePath(bytes memory f) internal pure returns (string memory) {
        bytes memory marker = bytes("app/dist/");
        uint256 at = type(uint256).max;
        for (uint256 i; i + marker.length <= f.length; i++) {
            bool m = true;
            for (uint256 j; j < marker.length; j++) {
                if (f[i + j] != marker[j]) {
                    m = false;
                    break;
                }
            }
            if (m) at = i + marker.length;
        }
        require(at != type(uint256).max && at < f.length, "file outside app/dist");
        bytes memory p = _slice(f, at, f.length);
        require(p[0] != "/" && !_contains(p, "..") && !_contains(p, "dist/") && !_contains(p, "\\"), "unsafe site path");
        return string(p);
    }

    function _is(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function _contains(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (s.length < p.length) return false;
        for (uint256 i; i + p.length <= s.length; i++) {
            bool m = true;
            for (uint256 j; j < p.length; j++) {
                if (s[i + j] != p[j]) {
                    m = false;
                    break;
                }
            }
            if (m) return true;
        }
        return false;
    }

    function _startsWith(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (s.length < p.length) return false;
        for (uint256 i; i < p.length; i++) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }

    function _uploadFile(string memory path, bytes memory data, bool asset) internal {
        bytes32 hash = sha256(data);
        uint256 chunks = (data.length + CHUNK - 1) / CHUNK;
        (,, bytes32 onchain,, uint256 have) = SITES.fileInfo(container, path);
        if (onchain == hash && have == chunks) return; // already complete
        uint256 start = onchain == hash && have > 0 && have < chunks ? have : 0; // resume a partial upload
        if (!_take(chunks - start, asset)) return;
        if (start == 0) {
            SITES.putFile(container, path, _contentType(path), hash, _slice(data, 0, data.length < CHUNK ? data.length : CHUNK));
            uploadedChunks++;
            start = 1;
        }
        for (uint256 c = start; c < chunks; c++) {
            uint256 from = c * CHUNK;
            SITES.appendChunk(container, path, c, _slice(data, from, from + CHUNK < data.length ? from + CHUNK : data.length));
            uploadedChunks++;
        }
        console2.log("uploaded", path, data.length);
        _done(chunks - (onchain == hash && have > 0 && have < chunks ? have : 0), asset);
    }

    /// Counts a file's missing chunks and says whether this run sends them (phase, budget and plan rules).
    function _take(uint256 missing, bool asset) internal returns (bool) {
        neededChunks += missing;
        if (asset) neededAssets += missing;
        else neededFinal += missing;
        if (plan || budgetHit) return false;
        bool home = _is(phase, "home");
        if (!(home || _is(phase, "all") || _is(phase, asset ? "assets" : "final"))) return false;
        if (!asset && !home && !_is(phase, "all") && neededAssets > 0) return false; // final files wait until every asset is on chain
        if (maxChunks != 0 && uploadedChunks + missing > maxChunks && uploadedChunks > 0) {
            budgetHit = true; // the next run continues from the chain
            return false;
        }
        return true;
    }

    function _done(uint256 missing, bool asset) internal {
        neededChunks -= missing;
        if (asset) neededAssets -= missing;
        else neededFinal -= missing;
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
