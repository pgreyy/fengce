// The Safes a connected wallet owns that the app knows about, and creating a new one.
// Sources: Safes used or created in this browser, and Safes seen in the Fengce event snapshot. Each is checked on chain
// (getOwners) so the list only shows Safes the wallet still owns. Safes made elsewhere can be added by address on /start.
import { useEffect, useState } from "react";
import { decodeFunctionResult, getAddress, parseAbi, type Address, type Hash } from "viem";
import { client } from "../lib/chain";
import { ENGINE, createSafeCalldata } from "./engine";
import { PREPARED, loadSnapshot } from "./reads";
import { CREATE_DEFAULTS, V3, createSafeV3Calldata } from "./v3";
import { chooseSafe, rememberedSafes, safeInfo, sendFromWallet, useWallet } from "./wallet";

const factoryAbi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);

export async function ownedSafes(owner: Address): Promise<Address[]> {
  const snap = await loadSnapshot();
  const seen = (snap?.events ?? []).map((e) => e.safe).filter(Boolean) as string[];
  const cands = [...new Set([...rememberedSafes(owner), ...seen.map((x) => getAddress(x))])];
  const ok = await Promise.all(
    cands.map((s) => safeInfo(s).then((i) => i.owners.some((o) => o.toLowerCase() === owner.toLowerCase()), () => false)),
  );
  return cands.filter((_, i) => ok[i]);
}

export function useOwnedSafes(): { safes: Address[]; loading: boolean; refresh: () => void } {
  const w = useWallet();
  const [safes, setSafes] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!w.account) return setSafes([]);
    let live = true;
    // show what this browser knows at once, then replace it with the on-chain checked list
    setSafes(rememberedSafes(w.account));
    setLoading(true);
    const cur = w.safe;
    ownedSafes(w.account)
      .then((s) => live && setSafes(cur && !s.some((x) => x.toLowerCase() === cur.toLowerCase()) ? [cur, ...s] : s))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => void (live = false);
  }, [w.account, w.safe, n]);
  return { safes, loading, refresh: () => setN((x) => x + 1) };
}

/** Creates a 1-of-1 Safe 1.5 owned by the connected wallet, with guard v3 and default limits (max 100 USDT0 per buy,
 * Tilt-shield on) installed in the same transaction, and makes it the chosen Safe. */
export async function createSafe(owner: Address): Promise<{ safe: Address; hash: Hash }> {
  // with FengceSetupV3 deployed: the new Safe gets guard v3 and default limits in the same transaction (one signature)
  const data = V3?.setup && PREPARED ? createSafeV3Calldata(owner, BigInt(Date.now()), CREATE_DEFAULTS, PREPARED) : createSafeCalldata(owner, BigInt(Date.now()));
  const sim = await client.call({ account: owner, to: ENGINE.safeFactory, data });
  const safe = getAddress(decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: sim.data! }) as Address);
  const r = await sendFromWallet(ENGINE.safeFactory, data);
  if (r.status !== "success") throw new Error("Creating the Safe reverted.");
  chooseSafe(safe);
  return { safe, hash: r.hash };
}
