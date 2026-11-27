// Limits → Add a circuit: the Fengce Catalog (listings on chain). Designers opt in by listing their pinned circuit with
// test vectors and an install fee; Catalog.payInstall splits each fee 80% to the designer, 20% to the treasury.
import { useEffect, useState } from "react";
import { encodeFunctionData, formatEther, parseAbi, type Address, type Hex } from "viem";
import { CatalogArtifact, PinRegistryArtifact, readCatalog, type CatalogEntry } from "@fengce/sdk";
import { ADDR, CATALOG, client } from "../lib/chain";
import { presetFor, type PolicyPreset } from "../lib/policies";
import { presetSchema } from "../lib/data";
import { parseAmount } from "./LimitsEditor";
import { usePolicy } from "./policyChange";
import { Addr, CIRCUIT, circuitHref, StartLink, short } from "./ui";
import { EXPLORER_TX, sendFromWallet, useWallet } from "./wallet";

const evalAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);

interface Row {
  entry: CatalogEntry;
  processor: Address;
  id: bigint;
  preset: PolicyPreset | undefined;
}

export function CatalogPanel() {
  const w = useWallet();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Row | null>(null);
  const [cap, setCap] = useState("2");
  const [tests, setTests] = useState<{ reason: string; want: string; got: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: Hex } | null>(null);

  useEffect(() => {
    if (!CATALOG) return setErr("No Fengce Catalog on X Layer yet.");
    readCatalog(client as never, CATALOG as Address)
      .then(async (es) => {
        const out = await Promise.all(
          es.filter((e) => e.active).map(async (entry) => {
            const c = (await client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [entry.pinId] })) as { processor: Address; circuitId: bigint };
            return { entry, processor: c.processor, id: c.circuitId, preset: presetFor(c.processor, c.circuitId) };
          }),
        );
        setRows(out);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  // run the listing's vectors on the live circuit (eth_call)
  useEffect(() => {
    setTests(null);
    if (!sel?.preset || sel.preset.stateful) return;
    Promise.all(
      sel.preset.vectors.map(async (v) => {
        const out = (await client.readContract({ address: sel.processor, abi: evalAbi, functionName: "eval", args: [sel.id, v.input] })) as Hex;
        const allow = (parseInt(out.slice(2, 4) || "0", 16) & 1) === 1;
        return { reason: v.reason, want: v.decision, got: allow ? "allow" : "deny" };
      }),
    ).then(setTests, () => setTests(null));
  }, [sel]);

  const capN = parseAmount(cap);
  const usesCap = !!sel?.preset && JSON.stringify(sel.preset.schema(1n)).includes("AmountGt");

  async function add() {
    setMsg(null);
    if (!sel?.preset || !w.account || !w.safe) return;
    setBusy("fee");
    try {
      if (sel.entry.installFee > 0n) {
        const r = await sendFromWallet(CATALOG as Address, (encodeFunctionData as (x: unknown) => Hex)({ abi: CatalogArtifact.abi, functionName: "payInstall", args: [sel.entry.pinId] }), undefined, sel.entry.installFee);
        if (r.status !== "success") throw new Error("The install fee payment reverted.");
      }
      setBusy("policy");
      const schema = await presetSchema(sel.preset, BigInt(Math.round((capN ?? 0) * 1e6)));
      const r = await usePolicy(w.account, w.safe, sel.entry.pinId, schema);
      setMsg({ ok: true, text: r.scheduled ? "Change scheduled: it can apply after the 1-day wait (My wallet shows the countdown)." : "Installed: your Safe now runs this circuit.", tx: r.hash });
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p className="body" style={{ maxWidth: 760 }}>
        Circuits in the Fengce Catalog, listed on X Layer by their designers with test vectors and a measured gas tier. Installing one pays its install fee once: 80% goes to
        the designer, 20% to the Fengce treasury (Catalog.payInstall).{" "}
        <a className="code-link" href={circuitHref(CIRCUIT.catalog)}>Catalog circuits in Docs</a>
      </p>
      {err && <span className="err">{err}</span>}
      {!rows && !err && <span className="small">Reading the Catalog on X Layer…</span>}
      <div className="g4" style={{ marginTop: 0, borderRadius: 14 }}>
        {rows?.map((r) => (
          <button key={r.entry.pinId} type="button" className={`rule-btn${sel?.entry.pinId === r.entry.pinId ? " on" : ""}`} onClick={() => setSel(r)}>
            <span className="rule-t">{r.preset?.name ?? short(r.entry.pinId)}</span>
            <span className="rule-d">{r.preset?.description ?? r.entry.description}</span>
            <span className="rule-s">
              {r.entry.tier} · {r.entry.installFee > 0n ? `${formatEther(r.entry.installFee)} OKB` : "free"} · #{String(r.id)}
            </span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">{sel.preset?.name ?? "Listing"}</span>
          {sel.preset && <span className="small">{sel.preset.construction}</span>}
          <div className="small" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span>Circuit <Addr value={sel.processor} label="Copy processor" /> #{String(sel.id)}</span>
            <span>Pin <Addr value={sel.entry.pinId} n={6} label="Copy pin" /></span>
            <span>Designer <Addr value={sel.entry.designer} label="Copy designer" /></span>
            <span>{sel.entry.allowVectors} allow and {sel.entry.denyVectors} deny vectors on chain</span>
          </div>
          {tests && (
            <div className="ts-log">
              {tests.map((t, i) => (
                <div key={i} className="ts-lr">
                  <span className="num muted" style={{ fontSize: 12 }}>eval</span>
                  <span>{t.reason}</span>
                  <span className={`tag ${t.got === t.want ? (t.got === "allow" ? "g" : "r") : "n"}`}>{t.got === t.want ? t.got.toUpperCase() : `got ${t.got}`}</span>
                </div>
              ))}
            </div>
          )}
          {!sel.preset && <span className="small">This listing has no schema in the app yet; install it with the SDK (configInput) and its manifest.</span>}
          {sel.preset?.stateful && <span className="small">A stateful circuit: it runs through Tick, installed with the SDK for now.</span>}
          {sel.preset && !sel.preset.stateful && (
            <>
              {usesCap && (
                <label style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="small">Cap (USDT0)</span>
                  <input className="field num" style={{ width: 120 }} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
                </label>
              )}
              {!w.account || !w.safe ? (
                <StartLink className="pill accent big">Connect to install</StartLink>
              ) : (
                <button type="button" className="pill accent big" style={{ alignSelf: "flex-start" }} disabled={!!busy || (usesCap && capN === null)} onClick={add}>
                  {busy === "fee" ? "Paying the install fee" : busy === "policy" ? "Confirm in your wallet" : sel.entry.installFee > 0n ? `Pay ${formatEther(sel.entry.installFee)} OKB and install` : "Install on my Safe"}
                </button>
              )}
              <span className="small">On a Safe that already runs Fengce, changing the circuit is scheduled and can apply after 1 day.</span>
            </>
          )}
          {msg && (
            <span className={msg.ok ? "mono" : "err"} style={{ fontSize: 14, color: msg.ok ? "var(--allow)" : undefined }}>
              {msg.text}
              {msg.tx && (
                <>
                  {" · "}
                  <a className="alink accent" href={EXPLORER_TX(msg.tx)} target="_blank" rel="noreferrer noopener">tx {short(msg.tx)}</a>
                </>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
