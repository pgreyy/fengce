// Attempts made from this browser (allowed and refused), kept per Safe in localStorage. Refused owner transactions leave
// no event on chain (they revert), so this is where the app remembers them; each one keeps its transaction hash if sent.
import type { Address, Hex } from "viem";

export interface Attempt {
  time: number;
  action: string;
  app: string;
  amount: string;
  ok: boolean;
  reason: string;
  tx?: Hex;
}
const key = (safe: Address) => `okun-activity:${safe.toLowerCase()}`;
export function attempts(safe: Address): Attempt[] {
  try {
    return JSON.parse(localStorage.getItem(key(safe)) ?? "[]") as Attempt[];
  } catch {
    return [];
  }
}
export function record(safe: Address, a: Attempt) {
  try {
    localStorage.setItem(key(safe), JSON.stringify([a, ...attempts(safe)].slice(0, 50)));
  } catch {
    /* storage blocked */
  }
}
