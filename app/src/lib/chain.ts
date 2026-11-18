import { createPublicClient, fallback, http, type Address } from "viem";
import deployment from "../../../deployments/xlayer-196-v2.json";

/** Runs in the browser (the static pages) and in Node (the Vercel API functions). */
const env: Record<string, string | undefined> = typeof process !== "undefined" && process.env ? process.env : {};

/** Public X Layer RPCs. Both accept browser CORS requests (checked 2026-11-18) and allow eth_getLogs over at most
 * 100 blocks per request. XLAYER_RPC (Node only) replaces them. */
export const RPCS = env.XLAYER_RPC ? [env.XLAYER_RPC] : ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];
/** True in the browser; false in the Vercel functions (Node). */
export const IN_BROWSER = typeof window !== "undefined";
// Browsers batch JSON-RPC calls; the server side sends them one by one (the public RPCs reject batched log
// queries from data-centre addresses more readily).
export const client = createPublicClient({
  transport: fallback(RPCS.map((u) => http(u, { retryCount: 3, retryDelay: 600, batch: IN_BROWSER ? { batchSize: 10 } : false }))),
});

/** Largest block range eth_getLogs accepts on the public X Layer RPCs. */
export const LOG_WINDOW = 100n;

export const ADDR = {
  tapeoutFactory: "0x1f09DAeFA827f02CBb40967cc91b259763760761" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  usdt0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Address,
  wokb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as Address,
  usdc: "0xB6CEceAB302E2E4948951eE7843FC24E92933061" as Address,
  uniV3Router: "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA" as Address,
  uniV2Router: "0x182a927119d56008d921126764bf884221b10f59" as Address,
  aavePool: "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116" as Address,
  /** FengceGuard of the current release (deployments/xlayer-196-v2.json). */
  guard: deployment.contracts.FengceGuard as Address,
  pinRegistry: deployment.contracts.PinRegistry as Address,
};

/** AgentExecutor whose Denied events are shown on Safe pages (AGENT_EXECUTOR overrides, Node only). */
export const AGENT_EXECUTOR = (env.AGENT_EXECUTOR as Address | undefined) ?? (deployment.contracts.AgentExecutor as Address);

/** Catalog contract (CATALOG_ADDRESS overrides, Node only). */
export const CATALOG = (env.CATALOG_ADDRESS as Address | undefined) ?? (deployment.contracts.Catalog as Address);

/** The live X Layer deployment (release v2), from deployments/xlayer-196-v2.json. */
export const DEPLOYMENT = deployment;
/** Block at which release v2 was deployed (deployments/manifest-xlayer-196-v2.json "block"): event scans never
 * need to look further back. */
export const DEPLOY_BLOCK = 76_250_360n;

export const EXPLORER = "https://www.oklink.com/x-layer";
