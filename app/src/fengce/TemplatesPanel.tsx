// Limits → Templates: Admin key guard, Vault and Treasury. Each installs guard v3 on a Safe with no guard yet, in one
// signature (fengce/templates.ts; checked on a fork by app/scripts/templates-fork.mts).
import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { PinRegistryArtifact, readCatalog, type SchemaFile } from "@fengce/sdk";
import { ADDR, CATALOG, client } from "../lib/chain";
import { presetFor } from "../lib/policies";
import { presetSchema } from "../lib/data";
import { multiSend } from "./engine";
import { parseAmount } from "./LimitsEditor";
import { PREPARED, readInstalled, type Installed } from "./reads";
import { TEMPLATES, templateCalls, type TemplateInfo } from "./templates";
import { href, openWallet, short } from "./ui";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "./wallet";

/** The Catalog's Periodic Spending Budget (#18): its pin and schema, for Treasury. */
async function loadBudget(): Promise<{ pinId: Hex; schema: SchemaFile } | null> {
  const es = await readCatalog(client as never, CATALOG as Address);
  for (const e of es.filter((x) => x.active)) {
    const c = (await client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [e.pinId] })) as { processor: Address; circuitId: bigint };
    const p = presetFor(c.processor, c.circuitId);
    if (p?.stateful && c.circuitId === 18n) return { pinId: e.pinId, schema: await presetSchema(p, 0n) };
  }
  return null;
}

export function TemplatesPanel({ installed, onDone }: { installed: Installed | null; onDone?: (i: Installed) => void }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="lbl">Ready-made setups · one signature on a new Safe</span>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <TemplateCard key={t.key} t={t} installed={installed} onDone={onDone} />
        ))}
      </div>
    </section>
  );
}

function TemplateCard({ t, installed, onDone }: { t: TemplateInfo; installed: Installed | null; onDone?: (i: Installed) => void }) {
  const w = useWallet();
  const [cap, setCap] = useState(t.key === "admin" ? "10000" : t.key === "vault" ? "100" : "500");
  const [partner, setPartner] = useState("");
  const [period, setPeriod] = useState<bigint>(86_400n);
  const [budget, setBudget] = useState<{ pinId: Hex; schema: SchemaFile } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: Hex } | null>(null);
  useEffect(() => {
    if (t.key === "treasury") loadBudget().then(setBudget, () => setBudget(null));
  }, [t.key]);

  const capN = parseAmount(cap);
  const partnerOk = !partner || isAddress(partner);
  const isOwner = !!installed && !!w.account && installed.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase());
  const otherGuard = installed && !/^0x0{40}$/i.test(String(installed.raw?.guard ?? "0x0000000000000000000000000000000000000000"));
  const blocker = !PREPARED
    ? "The limit circuits are not pinned yet."
    : !w.account || !w.safe
      ? null
      : !installed
        ? "Reading your Safe…"
        : !isOwner
          ? "The connected wallet is not an owner of this Safe."
          : installed.threshold > 1
            ? `This Safe needs ${installed.threshold} owner signatures; templates install on 1-of-1 Safes from here.`
            : installed.set || otherGuard
              ? "Templates install on a Safe with no limits yet. Create a new Safe from the wallet menu, then install."
              : capN === null
                ? "Enter a cap above 0."
                : !partnerOk
                  ? "The partner must be an address (or leave it empty)."
                  : t.key === "treasury" && !budget
                    ? "Reading the budget circuit from the Catalog…"
                    : null;

  async function install() {
    if (!w.account || !w.safe) return openWallet();
    setMsg(null);
    setBusy("Confirm in your wallet");
    try {
      const calls = templateCalls(t.key, w.safe, { cap: BigInt(Math.round(capN! * 1e6)), partner: partner ? (getAddress(partner) as Address) : undefined, budget: budget ? { ...budget, period } : undefined }, PREPARED!);
      const sim = await simulateSafeTx(w.account, w.safe, multiSend(calls));
      if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
      const r = await sendFromWallet(w.safe, sim.data);
      if (r.status !== "success") throw new Error("The transaction reverted on chain.");
      setMsg({ ok: true, text: `${t.name} is on: your Safe runs guard v3 with these rules.`, tx: r.hash });
      onDone?.(await readInstalled(w.safe));
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tpl-card">
      <div className="tpl-h">
        <span className="tpl-name">{t.name}</span>
        <span className="tpl-tag">{t.tagline}</span>
      </div>
      <span className="small">
        <b style={{ fontWeight: 500, color: "var(--text)" }}>For:</b> {t.who}
      </span>
      <div className="tpl-sec">
        <span className="lbl">Blocks</span>
        <ul>{t.blocks.map((b) => <li key={b}>{b}</li>)}</ul>
        {t.key === "admin" && (
          <span className="small">
            See Bybit, WazirX and Radiant in the <a className="alink" href={href("docs", { tab: "inc" })}>incident list</a>.
          </span>
        )}
      </div>
      <div className="tpl-sec">
        <span className="lbl">Rules</span>
        <ul>{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
      <div className="tpl-fields">
        <label className="cat-f">
          <span className="small">{t.key === "admin" ? "Max per transaction (USDT0)" : t.key === "vault" ? "Max per send (USDT0)" : "Max per payment (USDT0)"}</span>
          <input className="field num" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={capN === null} />
        </label>
        {t.key === "vault" && (
          <label className="cat-f">
            <span className="small">Partner (optional)</span>
            <input className="field mono" placeholder="0x…" value={partner} onChange={(e) => setPartner(e.target.value.trim())} aria-invalid={!partnerOk} />
          </label>
        )}
        {t.key === "treasury" && (
          <label className="cat-f">
            <span className="small">Budget period</span>
            <select className="field" value={String(period)} onChange={(e) => setPeriod(BigInt(e.target.value))}>
              <option value="3600">1 hour</option>
              <option value="86400">1 day</option>
              <option value="604800">1 week</option>
            </select>
          </label>
        )}
      </div>
      <span className="small tpl-gap">{t.gap}</span>
      <button type="button" className="pill accent big" disabled={!!busy || (!!w.account && !!w.safe && !!blocker)} onClick={install}>
        {busy ?? (!w.account || !w.safe ? "Connect to install" : `Install ${t.name}`)}
      </button>
      {w.account && w.safe && blocker && <span className="small">{blocker}</span>}
      {msg && (
        <span className={msg.ok ? "mono" : "err"} style={{ fontSize: 13.5, color: msg.ok ? "var(--allow)" : undefined }}>
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
  );
}
