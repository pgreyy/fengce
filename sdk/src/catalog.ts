import { type Address, type Hex, type PublicClient } from "viem";
import { CatalogArtifact } from "./artifacts.js";
import type { Tier } from "./tiers.js";

/** Tier names in Catalog.Tier order. */
export const CATALOG_TIERS = ["Green", "Amber", "Red", "Unsupported"] as const;
export type CatalogTier = (typeof CATALOG_TIERS)[number];

export interface CatalogEntry {
  pinId: Hex;
  certificateHash: Hex;
  tier: CatalogTier;
  gasFullPath: bigint;
  lister: Address;
  listedAt: bigint;
  active: boolean;
  uri: string;
}

function toEntry(e: any): CatalogEntry {
  return { ...e, tier: CATALOG_TIERS[Number(e.tier)] };
}

/** Reads every entry of a Catalog contract. */
export async function readCatalog(client: PublicClient, catalog: Address): Promise<CatalogEntry[]> {
  const n = (await client.readContract({ address: catalog, abi: CatalogArtifact.abi, functionName: "count" })) as bigint;
  const out: CatalogEntry[] = [];
  for (let i = 0n; i < n; i++) {
    out.push(toEntry(await client.readContract({ address: catalog, abi: CatalogArtifact.abi, functionName: "entryAt", args: [i] })));
  }
  return out;
}

/** Reads one entry by pin id (lister is the zero address if it is not listed). */
export async function catalogEntry(client: PublicClient, catalog: Address, pinId: Hex): Promise<CatalogEntry> {
  return toEntry(await client.readContract({ address: catalog, abi: CatalogArtifact.abi, functionName: "entryOf", args: [pinId] }));
}

/** Arguments for Catalog.list from a Quote certificate. */
export function catalogListArgs(pinId: Hex, cert: { tier: Tier | "Unsupported"; gas: { fullPath: string | null } }, uri = "") {
  return [pinId, CATALOG_TIERS.indexOf(cert.tier), BigInt(cert.gas.fullPath ?? 0), uri] as const;
}
