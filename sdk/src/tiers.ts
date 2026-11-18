import shared from "./tiers.json" with { type: "json" };

/**
 * Budget tiers in gas. The thresholds come from src/tiers.json, the same file the Catalog contract's
 * constants are checked against (test/unit/TiersShared.t.sol), so the SDK and the chain agree.
 * Quote applies them to the full Safe -> guard -> circuit path; the Catalog applies them to the gas of
 * the circuit evaluation (pin checks included) measured on-chain at listing.
 */
export const TIERS = {
  greenMaxGas: BigInt(shared.greenMaxGas),
  amberMaxGas: BigInt(shared.amberMaxGas),
} as const;

export type Tier = "Green" | "Amber" | "Red";

export function tierFor(gas: bigint): Tier {
  if (gas <= TIERS.greenMaxGas) return "Green";
  if (gas <= TIERS.amberMaxGas) return "Amber";
  return "Red";
}
