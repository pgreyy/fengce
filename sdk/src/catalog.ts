import { type Address, type Hex, type PublicClient } from "viem";
import { CatalogArtifact } from "./artifacts.js";

/** Tier names in Catalog.Tier order. */
export const CATALOG_TIERS = ["Green", "Amber", "Red"] as const;
export type CatalogTier = (typeof CATALOG_TIERS)[number];

export interface CatalogVector {
  input: Hex;
  expectedOutput: Hex;
  /** stateful circuits only (run with step()); "0x" otherwise */
  state: Hex;
}

/** Catalog.Manifest: what a lister submits. Every vector is run on-chain at listing. */
export interface CatalogManifest {
  pinId: Hex;
  description: string;
  schemaHash: Hex;
  vectors: CatalogVector[];
  designer: Address;
  installFee: bigint;
  uri: string;
}

export interface CatalogEntry {
  pinId: Hex;
  certificateHash: Hex;
  schemaHash: Hex;
  vectorsHash: Hex;
  allowVectors: number;
  denyVectors: number;
  measuredGas: bigint;
  tier: CatalogTier;
  lister: Address;
  designer: Address;
  installFee: bigint;
  listedAt: bigint;
  active: boolean;
  description: string;
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
