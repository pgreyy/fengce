/** Budget tiers for the full Safe -> guard -> circuit path, in gas. The single place to tune them. */
export const TIERS = {
  greenMaxGas: 1_000_000n,
  amberMaxGas: 3_500_000n,
} as const;

export type Tier = "Green" | "Amber" | "Red";

export function tierFor(gas: bigint): Tier {
  if (gas <= TIERS.greenMaxGas) return "Green";
  if (gas <= TIERS.amberMaxGas) return "Amber";
  return "Red";
}
