// "Add an existing Safe": check on X Layer that an address is a Safe, that the connected wallet owns it, and which
// transaction guard it runs (none, Fengce, or another one).
import { getAddress, isAddress, numberToHex, hexToBigInt, type Address } from "viem";
import { client } from "../lib/chain";
import { ENGINE } from "./engine";
import { safeInfo } from "./wallet";

/** keccak256("guard_manager.guard.address") */
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

/** FengceGuardV3 from the Milestone 2 deployment record, if it has been run. */
const v3 = import.meta.glob("../../../deployments/m2-demo-xlayer-196.json", { eager: true, import: "default" }) as Record<string, { guard?: string }>;
export const GUARD_V3: Address | null = (() => {
  const g = Object.values(v3)[0]?.guard;
  return g && isAddress(g) ? (getAddress(g) as Address) : null;
})();

export type GuardKind = "none" | "fengce-v2" | "fengce-v3" | "other";

export interface SafeCheck {
  safe: Address;
  owners: Address[];
  threshold: number;
  version: string;
  guard: Address | null;
  kind: GuardKind;
}

export async function guardOf(safe: Address): Promise<{ guard: Address | null; kind: GuardKind }> {
  const raw = await client.getStorageAt({ address: safe, slot: GUARD_SLOT });
  const w = raw ? hexToBigInt(raw) : 0n;
  if (w === 0n) return { guard: null, kind: "none" };
  const guard = getAddress(numberToHex(w, { size: 20 })) as Address;
  if (guard.toLowerCase() === ENGINE.guard.toLowerCase()) return { guard, kind: "fengce-v2" };
  if (GUARD_V3 && guard.toLowerCase() === GUARD_V3.toLowerCase()) return { guard, kind: "fengce-v3" };
  return { guard, kind: "other" };
}

/** Throws a plain-language error when the address is not a Safe on X Layer or `account` is not one of its owners. */
export async function checkExistingSafe(input: string, account: Address): Promise<SafeCheck> {
  const v = input.trim();
  if (!isAddress(v)) throw new Error("That is not an address.");
  const safe = getAddress(v) as Address;
  const code = await client.getCode({ address: safe });
  if (!code || code === "0x") throw new Error("There is no contract at this address on X Layer.");
  let info: Awaited<ReturnType<typeof safeInfo>>;
  try {
    info = await safeInfo(safe);
  } catch {
    throw new Error("This contract is not a Safe on X Layer.");
  }
  if (!info.owners.some((o) => o.toLowerCase() === account.toLowerCase())) throw new Error("The connected wallet is not an owner of this Safe.");
  return { safe, owners: info.owners, threshold: info.threshold, version: String(info.version), ...(await guardOf(safe)) };
}
