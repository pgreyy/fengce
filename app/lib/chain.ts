import "server-only";
import { createPublicClient, http, type Address } from "viem";

/** Read-only X Layer client. XLAYER_RPC overrides the endpoint (both OKX endpoints are official). */
export const RPC = process.env.XLAYER_RPC ?? "https://xlayerrpc.okx.com";
export const client = createPublicClient({ transport: http(RPC, { retryCount: 3, retryDelay: 500 }) });

export const ADDR = {
  tapeoutFactory: "0x1f09DAeFA827f02CBb40967cc91b259763760761" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  usdt0: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Address,
  wokb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as Address,
  usdc: "0xB6CEceAB302E2E4948951eE7843FC24E92933061" as Address,
  uniV3Router: "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA" as Address,
  uniV2Router: "0x182a927119d56008d921126764bf884221b10f59" as Address,
  aavePool: "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116" as Address,
  /** Predicted CREATE2 address (deployments/README.md). Not deployed. */
  predictedGuard: "0x89c4716dAf60b6213c33D181b534b49eB57e2e67" as Address,
};

/** Catalog contract, if one is deployed (CATALOG_ADDRESS). */
export const CATALOG = (process.env.CATALOG_ADDRESS as Address | undefined) ?? null;
