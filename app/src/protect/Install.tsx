import { useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { ADDR, DEPLOYMENT } from "../lib/chain";
import { install } from "../lib/data";
import { PRESETS } from "../lib/policies";
import { WALLETS, tone } from "../lib/wallets";
import { Addr, ErrorLine, Pill } from "../ui/kit";

/** Catalog pin of each preset in release v2 (deployments/xlayer-196-v2.json "pins"). */
const PIN_KEY: Record<string, keyof typeof DEPLOYMENT.pins> = {
  "nand-limit": "stablecoinTransferLimit",
  comparator16: "numericTransactionLimit",
  "policy-floor": "organizationWidePolicyFloor",
  "toggle-cap": "periodicSpendingBudget",
  "nor-swap": "protectedSwapPolicy",
};

const ADAPTER: Record<string, { name: string; address: string }> = {
  safe: { name: "FengceGuard", address: DEPLOYMENT.contracts.FengceGuard },
  kernel: { name: "FengceHook", address: DEPLOYMENT.contracts.FengceHook },
  mav2: { name: "FengceHook6900", address: DEPLOYMENT.contracts.FengceHook6900 },
  "7702": { name: "FengceHook6900", address: DEPLOYMENT.contracts.FengceHook6900 },
  coinbase: { name: "FengceAgentOwner", address: DEPLOYMENT.contracts.FengceAgentOwner },
};

const lines = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean) as Address[];

/** Wallets the install step can build calls for (the others show a note). */
export const INSTALLABLE = Object.keys(ADAPTER);

/** The install flow for one wallet type (step 2 of Protect). Safe: preflight of existing approvals, then Safe
 * Transaction Builder JSON. Other wallets: the exact install calls. Builds everything in the browser from live X
 * Layer reads; nothing is signed or sent here. */
export function InstallFlow({ type }: { type: string }) {
  const w = WALLETS.find((x) => x.key === type)!;
  const [safe, setSafe] = useState<string>(DEPLOYMENT.demoSafe);
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [cap, setCap] = useState("1000000");
  const [tokens, setTokens] = useState(ADDR.usdt0);
  const [spenders, setSpenders] = useState(`${ADDR.uniV3Router}\n${ADDR.uniV2Router}`);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const pinId = DEPLOYMENT.pins[PIN_KEY[preset]] as Hex;

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      if (!isAddress(safe)) throw new Error("Safe address is not an address");
      setRes(
        await install({ safe: safe as Address, pinId, preset, cap, tokens: lines(tokens), spenders: lines(spenders), keep: [...keep] }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(res.transactionBuilder, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fengce-install-${safe.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
        <ol className="steps">
          <li>
            <div>
              <h3>Wallet</h3>
              <div className="tablewrap" style={{ marginTop: 16 }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Wallet</th>
                      <th>Owner path</th>
                      <th>Agents</th>
                      <th>Removal</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="name">
                        {w.wallet}
                        <div className="muted" style={{ fontWeight: 400 }}>
                          {ADAPTER[type].name} <Addr a={ADAPTER[type].address} />
                        </div>
                      </td>
                      {[w.owner, w.agents, w.removal].map((c, i) => (
                        <td key={i} style={{ maxWidth: 260 }}>
                          <Pill tone={tone(c.state)}>{c.state}</Pill>
                          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                            {c.text}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              {type === "safe" ? (
                <p className="note">
                  Once installed, removing Fengce needs <b>every owner's signature</b> and at least a <b>2-day delay</b> (recovery), and the schedule is
                  public on chain. Policy and module changes wait for the admin delay.
                </p>
              ) : (
                <p className={`note ${w.removal.state === "gap" ? "red" : ""}`}>Removal: {w.removal.text}.</p>
              )}
            </div>
          </li>
          {type === "safe" ? (
            <>
              <li>
                <div>
                  <h3>Safe and policy</h3>
                  <div className="grid">
                    <label className="field c6">
                      <span>Safe address</span>
                      <input className="mono" value={safe} onChange={(e) => setSafe(e.target.value)} />
                    </label>
                    <label className="field c4">
                      <span>Policy</span>
                      <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                        {PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field c2" style={{ gridColumn: "span 2" }}>
                      <span>Cap (base units)</span>
                      <input className="mono" value={cap} onChange={(e) => setCap(e.target.value)} />
                    </label>
                    <label className="field c6">
                      <span>Tokens to preflight</span>
                      <textarea className="mono" rows={3} value={tokens} onChange={(e) => setTokens(e.target.value as Address)} />
                    </label>
                    <label className="field c6">
                      <span>Spenders to preflight (Permit2 is always added)</span>
                      <textarea className="mono" rows={3} value={spenders} onChange={(e) => setSpenders(e.target.value)} />
                    </label>
                  </div>
                  <p className="muted mono" style={{ fontSize: 12 }}>
                    pin {pinId}
                  </p>
                  <button className="btn" type="button" disabled={busy} onClick={run}>
                    {busy ? "Reading…" : "Run preflight"}
                  </button>
                  <ErrorLine error={err} />
                </div>
              </li>
              <li>
                <div>
                  <h3>Preflight</h3>
                  {res ? (
                    <div className="tablewrap">
                      <table className="dt">
                        <thead>
                          <tr>
                            <th>Token</th>
                            <th>Spender</th>
                            <th>Check</th>
                            <th>State</th>
                            <th className="num">Amount</th>
                            <th>Keep</th>
                          </tr>
                        </thead>
                        <tbody>
                          {res.preflight.map((r: any, i: number) => {
                            const key = `${r.token}:${r.spender}`.toLowerCase();
                            return (
                              <tr key={i}>
                                <td>
                                  <Addr a={r.token} />
                                </td>
                                <td>
                                  <Addr a={r.spender} />
                                </td>
                                <td>{r.check}</td>
                                <td>
                                  <Pill tone={r.state === "checked" ? "checked" : r.state === "found" ? "deny" : "neutral"}>{r.state}</Pill>
                                </td>
                                <td className="num">{r.amount ?? "–"}</td>
                                <td>
                                  {(r.state === "found" || r.state === "kept") && (
                                    <input
                                      type="checkbox"
                                      style={{ width: "auto" }}
                                      checked={keep.has(key)}
                                      onChange={(e) => {
                                        const n = new Set(keep);
                                        if (e.target.checked) n.add(key);
                                        else n.delete(key);
                                        setKeep(n);
                                      }}
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">Checked: read, nothing found. Found: an approval exists (revoke it, or keep it and re-run). Not checked: the read failed.</p>
                  )}
                  {res?.error && <p className="err">{res.error}</p>}
                </div>
              </li>
              <li>
                <div>
                  <h3>Transaction Builder JSON</h3>
                  {res?.transactionBuilder ? (
                    <>
                      <p className="muted">{res.transactionBuilder.transactions.length} transactions, in order. Import into the Safe Transaction Builder and sign.</p>
                      <div className="row" style={{ marginBottom: 10 }}>
                        <button className="btn" type="button" onClick={download}>
                          Download JSON
                        </button>
                      </div>
                      <pre className="json">{JSON.stringify(res.transactionBuilder, null, 2)}</pre>
                    </>
                  ) : (
                    <p className="muted">Appears after a clean preflight.</p>
                  )}
                </div>
              </li>
            </>
          ) : (
            <li>
              <div>
                <h3>Steps</h3>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {(w.install ?? []).map((s, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {s}
                    </li>
                  ))}
                </ol>
                <p className="muted" style={{ fontSize: 12 }}>
                  Policy pin for {PRESETS.find((p) => p.key === preset)!.name}: <span className="mono">{pinId}</span>. Details and tests: docs/WALLETS.md.
                </p>
              </div>
            </li>
          )}
        </ol>
    </>
  );
}
