import { useState } from "react";
import { decodeFunctionResult, getAddress, isAddress, parseAbi, type Address } from "viem";
import { client } from "../lib/chain";
import { ENGINE, createSafeCalldata } from "./engine";
import { short } from "./ui";
import { EXPLORER_TX, chooseSafe, safeInfo, sendFromWallet, useWallet } from "./wallet";

const factoryAbi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);

/** Use an existing Safe the connected wallet owns, or create a new 1-of-1 Safe for it. */
export function SafePicker({ onChosen }: { onChosen?: (safe: Address) => void }) {
  const w = useWallet();
  const [addr, setAddr] = useState(w.safe ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function useExisting() {
    setMsg(null);
    if (!isAddress(addr)) return setMsg({ ok: false, text: "That is not an address." });
    setBusy("check");
    try {
      const i = await safeInfo(getAddress(addr));
      if (!w.account || !i.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase())) throw new Error("The connected wallet is not an owner of this Safe.");
      chooseSafe(getAddress(addr));
      setMsg({ ok: true, text: `Safe ${i.version} · ${i.threshold} of ${i.owners.length} owners${i.threshold > 1 ? " · installing needs the Safe app for more signatures" : ""}` });
      onChosen?.(getAddress(addr));
    } catch (e) {
      setMsg({ ok: false, text: /returned no data|reverted|0x/.test((e as Error).message) ? "No Safe at this address on X Layer." : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function createNew() {
    setMsg(null);
    if (!w.account) return;
    setBusy("create");
    try {
      const data = createSafeCalldata(w.account, BigInt(Date.now()));
      const sim = await client.call({ account: w.account, to: ENGINE.safeFactory, data });
      const safe = decodeFunctionResult({ abi: factoryAbi, functionName: "createProxyWithNonce", data: sim.data! }) as Address;
      const r = await sendFromWallet(ENGINE.safeFactory, data);
      if (r.status !== "success") throw new Error("Creating the Safe reverted.");
      chooseSafe(getAddress(safe));
      setAddr(safe);
      setMsg({ ok: true, text: `New Safe ${short(safe)} created (tx ${short(r.hash)}). Send it some USDT0 to trade.` });
      onChosen?.(getAddress(safe));
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
      <span className="mono small">Connected {w.account ? short(w.account) : "–"}</span>
      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 18 }}>Use my Safe</span>
        <span className="small">Limits are installed on this Safe. Nothing moves.</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x… Safe address" aria-label="Safe address" />
          <button type="button" className="pill solid" disabled={!!busy || !w.account} onClick={useExisting}>
            {busy === "check" ? "Reading" : "Use"}
          </button>
        </div>
      </div>
      <button type="button" className="card" disabled={!!busy || !w.account} onClick={createNew} style={{ padding: 20, textAlign: "left", display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 18 }}>{busy === "create" ? "Confirm in your wallet" : "Create a new Safe"}</span>
        <span className="small">A Safe 1.5 owned only by your connected wallet. One transaction; then install your limits with one more signature.</span>
      </button>
      {msg && (
        <span className={msg.ok ? "mono" : "err"} style={{ fontSize: 14, color: msg.ok ? "var(--allow)" : undefined }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

export { EXPLORER_TX };
