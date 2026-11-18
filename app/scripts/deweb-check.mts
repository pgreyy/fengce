// Checks the app published on TapeOut DeWeb (deployments/deweb-xlayer-196.json) the way a TAP-10 kernel resolves it:
// processor number -> processor contract -> container (derived, never reported), opened, store and payment
// implementations accepted, name activated, then every file read back from SiteRegistry with its size and SHA-256
// verified. With an output folder, writes the verified files there (to load them in a browser). Read-only.
// Usage: npx tsx scripts/deweb-check.mts [outDir]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPublicClient, fallback, getAddress, http, parseAbi, type Address, type Hex } from "viem";

const d = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../deployments/deweb-xlayer-196.json"), "utf8"));
const out = process.argv[2] ? resolve(process.argv[2]) : null;
const client = createPublicClient({ transport: fallback([http("https://xlayerrpc.okx.com", { retryCount: 4 }), http("https://rpc.xlayer.tech", { retryCount: 4 })]) });

// TAP-10 Deployments (X Layer) and accepted implementations.
const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761" as Address;
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106" as Address;
const SITES = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6" as Address;
const BINDING = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9" as Address;
const ACCEPTED: Record<string, string> = { [SITES]: "0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f", [BINDING]: "0x5ebf29b80789e548907c707530c3c7607c4347df" };
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const abi = parseAbi([
  "function cpuAt(uint256) view returns (address)",
  "function accountOf(address,uint256) view returns (address)",
  "function isOpened(address,uint256) view returns (bool)",
  "function ownerOf(uint256) view returns (address)",
  "function isLive(string,address) view returns (bool)",
  "function isContainerLive(address) view returns (bool)",
  "function containerPaidUntil(address) view returns (uint40)",
  "function pathCount(address) view returns (uint256)",
  "function pathsRange(address,uint256,uint256) view returns (string[])",
  "function fallbackPath(address) view returns (string)",
  "function fileInfo(address,string) view returns (uint32,string,bytes32,uint40,uint256)",
  "function readRange(address,string,uint256,uint256) view returns (bytes)",
]);

const [idText, area, cpuNumber] = String(d.name).replace(/\.tape$/, "").split(".");
const id = BigInt(idText);
const block = (await client.getBlockNumber()) - 2n; // pinned block, as a kernel would
const r = <T,>(address: Address, functionName: string, args: unknown[] = []) => client.readContract({ address, abi, functionName: functionName as any, args: args as any, blockNumber: block }) as Promise<T>;

const checks: [string, boolean, string][] = [];
const processor = await r<Address>(FACTORY, "cpuAt", [BigInt(cpuNumber)]);
checks.push(["area code 2 = X Layer", area === "2", `name ${d.name}`]);
checks.push(["processor number -> contract", processor.toLowerCase() === String(d.processor).toLowerCase(), `cpuAt(${cpuNumber}) = ${processor}`]);
const container = await r<Address>(OPENER, "accountOf", [processor, id]);
checks.push(["container derived from name", container.toLowerCase() === String(d.container).toLowerCase(), `accountOf = ${container}`]);
checks.push(["container opened", await r<boolean>(OPENER, "isOpened", [processor, id]), ""]);
const holder = await r<Address>(processor, "ownerOf", [id]);
for (const p of [SITES, BINDING]) {
  const impl = getAddress(`0x${(await client.getStorageAt({ address: p, slot: IMPL_SLOT, blockNumber: block }))!.slice(-40)}`);
  checks.push([`implementation accepted (${p === SITES ? "SiteRegistry" : "DomainBinding"})`, impl.toLowerCase() === ACCEPTED[p], impl]);
}
const live = await r<boolean>(BINDING, "isLive", [d.name, container]);
const containerLive = await r<boolean>(BINDING, "isContainerLive", [container]).catch(() => false);
const paidUntil = await r<number>(BINDING, "containerPaidUntil", [container]).catch(() => 0);
checks.push(["name activated (status ok)", live || containerLive, `isLive ${live}, isContainerLive ${containerLive}, paid until ${new Date(Number(paidUntil) * 1000).toISOString().slice(0, 10)}`]);

const n = await r<bigint>(SITES, "pathCount", [container]);
const paths = await r<string[]>(SITES, "pathsRange", [container, 0n, n]);
const fb = await r<string>(SITES, "fallbackPath", [container]);
checks.push(["fallback path", fb === "index.html", fb]);
let bytes = 0;
let localSame = 0;
for (const p of paths) {
  const [size, ctype, sha] = await r<[number, string, Hex, number, bigint]>(SITES, "fileInfo", [container, p]);
  let data = Buffer.alloc(0);
  for (let o = 0; o < size; o += 98304) data = Buffer.concat([data, Buffer.from((await r<Hex>(SITES, "readRange", [container, p, BigInt(o), 98304n])).slice(2), "hex")]);
  const got = `0x${createHash("sha256").update(data).digest("hex")}`;
  const okFile = data.length === size && got === sha.toLowerCase();
  checks.push([`file ${p}`, okFile, `${size} bytes, ${ctype}, sha256 ${okFile ? "verified" : `MISMATCH ${got}`}`]);
  bytes += size;
  const local = resolve(import.meta.dirname, "../dist", p);
  if (existsSync(local) && createHash("sha256").update(readFileSync(local)).digest("hex") === got.slice(2)) localSame++;
  if (out) {
    mkdirSync(dirname(resolve(out, p)), { recursive: true });
    writeFileSync(resolve(out, p), data);
  }
}

for (const [what, ok, note] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${what}${note ? `: ${note}` : ""}`);
console.log(`\n${d.name} at block ${block}: processor #${cpuNumber} ${processor}, circuit #${id} (holder ${holder}), container ${container}`);
console.log(`${paths.length} files, ${bytes} bytes on chain; ${localSame} identical to the local app/dist build`);
process.exit(checks.every((c) => c[1]) ? 0 : 1);
