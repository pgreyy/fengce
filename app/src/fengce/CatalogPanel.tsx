// Limits → Add a circuit: the Fengce Catalog as a list, one circuit per row. A row expands in place with its details; Add
// opens a confirm sheet and installs it on the chosen Safe with one signature (Catalog.payInstall and the install in one
// batch). Listings are on chain: a designer lists a pinned circuit with test vectors (checked on chain at listing) and an
// install fee, which Catalog.payInstall splits 80% to the designer and 20% to the treasury.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { encodeFunctionData, formatEther, getAddress, isAddress, parseAbi, type Address, type Hex } from "viem";
import { PinRegistryArtifact, TickArtifact, readCatalog, type CatalogEntry } from "@fengce/sdk";
import { ADDR, CATALOG, client } from "../lib/chain";
import { presetFor, type PolicyPreset } from "../lib/policies";
import { presetSchema } from "../lib/data";
import { catalogGroupId, catalogPlan, removeTickCall, type CatalogPlan } from "./catalogInstall";
import { ENGINE, multiSend, type Call } from "./engine";
import { parseAmount } from "./LimitsEditor";
import { PREPARED, readInstalled, type Installed } from "./reads";
import { Addr, CIRCUIT, circuitHref, href, openWallet, short } from "./ui";
import { GUARD_V3 } from "./addSafe";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "./wallet";

const evalAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

interface Row {
  entry: CatalogEntry;
  processor: Address;
  id: bigint;
  preset: PolicyPreset | undefined;
}

const PERIODS: [string, bigint][] = [["1 hour", 3_600n], ["1 day", 86_400n], ["1 week", 604_800n]];
const usesCap = (p?: PolicyPreset) => !!p && JSON.stringify(p.schema(1n)).includes("AmountGt");
const gasK = (g: bigint) => `${Math.round(Number(g) / 1000)}k gas`;
const fee = (f: bigint) => (f > 0n ? `${formatEther(f)} OKB` : "Free during launch");
const errText = (e: unknown) => (e as { shortMessage?: string }).shortMessage ?? (e as Error).message;

/** What this Safe runs from the Catalog: its policy pin and the pin behind its Tick group. */
interface SafeState {
  inst: Installed;
  tickPin: Hex | null;
  relayerSet: boolean;
}

async function readSafeState(safe: Address): Promise<SafeState> {
  const inst = await readInstalled(safe);
  let tickPin: Hex | null = null;
  if (inst.tick && inst.tickGroup) {
    const g = (await client.readContract({ address: inst.tick, abi: TickArtifact.abi as any, functionName: "groupOf", args: [inst.tickGroup] })) as unknown[];
    tickPin = g[1] as Hex;
  }
  const relayerSet = (await client.readContract({ address: ENGINE.tick, abi: TickArtifact.abi as any, functionName: "relayers", args: [safe, ENGINE.guard] })) as boolean;
  return { inst, tickPin, relayerSet };
}

/** What the Safe's one Tick slot (guard v2) runs now, by name; null when it is free. */
function occupantOf(st: SafeState | null, rows: Row[]): string | null {
  if (!st?.inst.tick || !st.tickPin) return null;
  const pin = st.tickPin.toLowerCase();
  const n = PREPARED ? Object.entries(PREPARED.counterPins).find(([, p]) => p.toLowerCase() === pin)?.[0] : undefined;
  if (n) return `trades per hour (${n} per hour)`;
  const r = rows.find((x) => x.entry.pinId.toLowerCase() === pin);
  return r ? `${r.preset?.name ?? "a Catalog circuit"} (#${r.id})` : `the stateful circuit on pin ${short(st.tickPin, 6)}`;
}

/** Import by ID: a circuit number (18 or #18), a processor address, or a pin id. */
function lookup(q: string, rows: Row[], all: CatalogEntry[]): { rows: Row[] } | { error: string } {
  const s = q.trim();
  const num = /^#?(\d{1,6})$/.exec(s);
  if (num) {
    const hit = rows.filter((r) => r.id === BigInt(num[1]));
    return hit.length ? { rows: hit } : { error: `Circuit #${num[1]} is not in the Fengce Catalog. Only listed circuits, whose test vectors passed on chain, can be added here; others go through Build your own.` };
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) {
    const hit = rows.filter((r) => r.entry.pinId.toLowerCase() === s.toLowerCase());
    if (hit.length) return { rows: hit };
    return { error: all.some((e) => e.pinId.toLowerCase() === s.toLowerCase()) ? "This pin was delisted by its designer, so it can no longer be added." : "This pin is not listed in the Fengce Catalog." };
  }
  if (isAddress(s)) {
    const hit = rows.filter((r) => r.processor.toLowerCase() === s.toLowerCase());
    return hit.length ? { rows: hit } : { error: `No Catalog listing runs on ${short(getAddress(s))}. Only listed circuits can be added here.` };
  }
  return { error: "Enter a circuit number (like 18), a processor address or a pin id (0x and 64 hex digits)." };
}

export function CatalogPanel() {
  const w = useWallet();
  const [all, setAll] = useState<CatalogEntry[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Hex | null>(null);
  const [search, setSearch] = useState("");
  const [imp, setImp] = useState("");
  const [found, setFound] = useState<{ rows: Row[] } | { error: string } | null>(null);
  const [sheet, setSheet] = useState<{ row: Row; mode: "add" | "remove" } | null>(null);
  const [st, setSt] = useState<SafeState | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!CATALOG) return setErr("No Fengce Catalog on X Layer yet.");
    readCatalog(client as never, CATALOG as Address)
      .then(async (es) => {
        setAll(es);
        const out = await Promise.all(
          es.filter((e) => e.active).map(async (entry) => {
            const c = (await client.readContract({ address: ADDR.pinRegistry, abi: PinRegistryArtifact.abi as never, functionName: "circuitPin", args: [entry.pinId] })) as { processor: Address; circuitId: bigint };
            return { entry, processor: getAddress(c.processor) as Address, id: c.circuitId, preset: presetFor(c.processor, c.circuitId) };
          }),
        );
        setRows(out);
      })
      .catch((e) => setErr(errText(e)));
  }, []);

  useEffect(() => {
    setSt(null);
    if (!w.safe) return;
    let live = true;
    readSafeState(w.safe).then((s) => live && setSt(s), () => live && setSt(null));
    return () => void (live = false);
  }, [w.safe, tick]);

  const added = (r: Row) =>
    !!st && ((r.preset?.stateful ? st.tickPin : st.inst.set ? st.inst.pinId : null)?.toLowerCase() === r.entry.pinId.toLowerCase());

  const shown = useMemo(() => {
    if (!rows) return [];
    if (found && "rows" in found) return found.rows;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.preset?.name, r.preset?.description, r.entry.description, `#${r.id}`, r.processor, r.entry.designer, r.preset?.stateful ? "stateful" : "stateless"].some((x) => x?.toLowerCase().includes(q)));
  }, [rows, search, found]);

  const doImport = () => {
    if (!rows) return;
    const res = lookup(imp, rows, all);
    setFound(res);
    if ("rows" in res && res.rows.length === 1) setOpen(res.rows[0].entry.pinId);
  };

  const add = (r: Row) => {
    if (!w.account || !w.safe) return openWallet();
    setSheet({ row: r, mode: "add" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="cat-top">
        <p className="body" style={{ maxWidth: 640 }}>
          Circuits already taped out on X Layer and listed by their designers, with test vectors checked on chain. Open one to see what it reads; add it to your Safe with one signature. Listings are free during launch; when a designer sets a fee, Catalog.payInstall sends 80% to the designer and 20% to the treasury.
        </p>
        <input className="field" style={{ width: 240 }} aria-label="Search circuits" placeholder="Search circuits" value={search} onChange={(e) => (setSearch(e.target.value), setFound(null))} />
      </div>

      <div className="cat-imp">
        <label htmlFor="cat-id" className="lbl">Import by ID</label>
        <form className="cat-imp-row" onSubmit={(e) => (e.preventDefault(), doImport())}>
          <input id="cat-id" className="field mono" value={imp} onChange={(e) => setImp(e.target.value)} placeholder="Circuit # (18), processor address or pin id" spellCheck={false} />
          <button type="submit" className="pill line" disabled={!rows || !imp.trim()}>Find</button>
          {found && (
            <button type="button" className="alink" onClick={() => (setFound(null), setImp(""))}>Show all</button>
          )}
        </form>
        {found && "error" in found && <span className="err" style={{ fontSize: 14 }}>{found.error}</span>}
        {found && "rows" in found && <span className="small" style={{ color: "var(--allow)" }}>In the Fengce Catalog: {found.rows.length === 1 ? "1 listing" : `${found.rows.length} listings`}.</span>}
      </div>

      {err && <span className="err">{err}</span>}
      <div className="act-scroll">
        <div className="cat" role="table" aria-label="Fengce Catalog circuits">
          <div className="cat-r cat-h" role="row">
            {["Circuit", "#", "Type", "Gas tier", "Install fee", "Designer", "Test vectors", ""].map((h, i) => (
              <span key={i} role="columnheader" className={i === 7 ? "r" : undefined}>{h}</span>
            ))}
          </div>
          {!rows && !err &&
            [0, 1, 2].map((i) => (
              <div key={i} className="cat-r" role="row">
                <span><i className="sk" style={{ width: 200 }} /></span>
                {[1, 2, 3, 4, 5, 6, 7].map((k) => <span key={k}><i className="sk" style={{ width: 48 }} /></span>)}
              </div>
            ))}
          {rows && shown.length === 0 && <div className="cat-empty small">No circuit matches “{search}”.</div>}
          {shown.map((r) => {
            const on = open === r.entry.pinId;
            const isAdded = added(r);
            return (
              <Fragment key={r.entry.pinId}>
                <div
                  className={`cat-r cat-row${on ? " on" : ""}`}
                  role="row"
                  tabIndex={0}
                  aria-expanded={on}
                  onClick={() => setOpen(on ? null : r.entry.pinId)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setOpen(on ? null : r.entry.pinId))}
                >
                  <span className="cat-name">
                    <span className="cat-t">{r.preset?.name ?? r.entry.description.split(":")[0]}</span>
                    <span className="cat-d">{r.preset?.description ?? r.entry.description}</span>
                  </span>
                  <span>
                    <a className="code-link mono" href={circuitHref(CIRCUIT.catalog)} title={`Circuit #${r.id} on ${r.processor}`} onClick={(e) => e.stopPropagation()}>#{String(r.id)}</a>
                  </span>
                  <span className="muted">{r.preset?.stateful ? "Stateful" : "Stateless"}</span>
                  <span className="cat-gas"><span className="tag g">{r.entry.tier}</span><span className="mono muted">{gasK(r.entry.measuredGas)}</span></span>
                  <span className="mono">{fee(r.entry.installFee)}</span>
                  <span className="mono muted" title={r.entry.designer}>{short(r.entry.designer)}</span>
                  <span className="mono" style={{ color: "var(--allow)" }}>{r.entry.allowVectors} allow · {r.entry.denyVectors} deny</span>
                  <span className="r cat-act" onClick={(e) => e.stopPropagation()}>
                    {isAdded ? (
                      <span className="cat-added">
                        <span className="tag g">Added</span>
                        {r.preset?.stateful ? (
                          <button type="button" className="alink" onClick={() => setSheet({ row: r, mode: "remove" })}>Remove · 1 day</button>
                        ) : (
                          <a className="alink" href={href("limits", { tab: "tpl" })}>Loosen · 1 day</a>
                        )}
                      </span>
                    ) : (
                      <button type="button" className="pill line cat-add" disabled={!r.preset} title={r.preset ? undefined : "No schema for this listing in the app yet"} onClick={() => add(r)}>
                        Add
                      </button>
                    )}
                  </span>
                </div>
                {on && <Details row={r} />}
              </Fragment>
            );
          })}
        </div>
      </div>
      {sheet && <Sheet row={sheet.row} mode={sheet.mode} st={st} occupant={occupantOf(st, rows ?? [])} onClose={() => setSheet(null)} onDone={() => setTick((t) => t + 1)} />}
    </div>
  );
}

/** The expanded row: what the circuit does, how it is built, its addresses, and the listing's vectors run live. */
function Details({ row }: { row: Row }) {
  const [tests, setTests] = useState<{ reason: string; want: string; got: string }[] | null>(null);
  useEffect(() => {
    setTests(null);
    if (!row.preset || row.preset.stateful) return;
    Promise.all(
      row.preset.vectors.map(async (v) => {
        const out = (await client.readContract({ address: row.processor, abi: evalAbi, functionName: "eval", args: [row.id, v.input] })) as Hex;
        const allow = (parseInt(out.slice(2, 4) || "0", 16) & 1) === 1;
        return { reason: v.reason, want: v.decision, got: allow ? "allow" : "deny" };
      }),
    ).then(setTests, () => setTests(null));
  }, [row]);
  const p = row.preset;
  return (
    <div className="cat-x" role="row">
      <div className="cat-x-l">
        <span className="lbl">How it works</span>
        <span className="body" style={{ fontSize: 15 }}>{p?.description ?? row.entry.description}</span>
        {p && <span className="small">{p.construction}</span>}
        {p?.stateful && <span className="small">Stateful: Fengce's Tick contract keeps its state for your Safe, advances it on every transaction the guard checks, and resets it each period you choose.</span>}
      </div>
      <div className="cat-x-r">
        <div className="addr-row"><span>Circuit</span><span className="mono" style={{ fontSize: 13 }}>#{String(row.id)} on <Addr value={row.processor} label="Copy processor address" /></span></div>
        <div className="addr-row"><span>Pin</span><Addr value={row.entry.pinId} n={6} label="Copy pin id" /></div>
        <div className="addr-row"><span>Designer</span><Addr value={row.entry.designer} label="Copy designer address" /></div>
        <div className="addr-row"><span>Measured gas</span><span className="mono" style={{ fontSize: 13 }}>{row.entry.measuredGas.toLocaleString("en-US")} · {row.entry.tier}</span></div>
        {tests && (
          <div className="ts-log" style={{ marginTop: 6 }}>
            {tests.map((t, i) => (
              <div key={i} className="ts-lr">
                <span className="num muted" style={{ fontSize: 12 }}>eval</span>
                <span>{t.reason}</span>
                <span className={`tag ${t.got === t.want ? (t.got === "allow" ? "g" : "r") : "n"}`}>{t.got === t.want ? t.got.toUpperCase() : `got ${t.got}`}</span>
              </div>
            ))}
          </div>
        )}
        {p?.stateful && (
          <div className="ts-log" style={{ marginTop: 6 }}>
            {p.vectors.map((v, i) => (
              <div key={i} className="ts-lr">
                <span className="num muted" style={{ fontSize: 12 }}>step</span>
                <span>{v.reason}</span>
                <span className={`tag ${v.decision === "allow" ? "g" : "r"}`}>{v.decision.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
        {p?.stateful && <span className="small">Stateful vectors were stepped on chain when the circuit was listed (Catalog.list); the browser cannot re-run a step without changing state.</span>}
      </div>
    </div>
  );
}

/** Confirm sheet: what the rule does, its values, the fee and its split, the calls, then the signature(s). */
function Sheet({ row, mode, st, occupant, onClose, onDone }: { row: Row; mode: "add" | "remove"; st: SafeState | null; occupant: string | null; onClose: () => void; onDone: () => void }) {
  const w = useWallet();
  const p = row.preset!;
  const [cap, setCap] = useState("2");
  const [base, setBase] = useState("5");
  const [period, setPeriod] = useState<bigint>(86_400n);
  const [plan, setPlan] = useState<CatalogPlan | { error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; txs: Hex[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [busy, onClose]);

  const capN = parseAmount(cap);
  const baseN = parseAmount(base);
  const set = !!st?.inst.set;
  const needsBase = p.stateful && !set;
  const replaces = mode === "add" && !!p.stateful && !!occupant && st?.tickPin?.toLowerCase() !== row.entry.pinId.toLowerCase();

  useEffect(() => {
    if (mode === "remove" || !w.safe || !st) return setPlan(null);
    if ((usesCap(p) && capN === null) || (needsBase && baseN === null)) return setPlan(null);
    let live = true;
    presetSchema(p, BigInt(Math.round((capN ?? 0) * 1e6)))
      .then(async (schema) => {
        const groupExists = p.stateful
          ? ((await client.readContract({ address: ENGINE.tick, abi: TickArtifact.abi as any, functionName: "groupOf", args: [catalogGroupId(w.safe!, row.entry.pinId)] })) as unknown[])[0] !== ZERO
          : false;
        return catalogPlan({
          safe: w.safe!,
          catalog: CATALOG as Address,
          pinId: row.entry.pinId,
          installFee: row.entry.installFee,
          schema,
          stateful: !!p.stateful,
          fengceSet: set,
          period,
          baseMaxPerBuy: needsBase ? BigInt(Math.round(baseN! * 1e6)) : undefined,
          prepared: PREPARED,
          groupExists,
          relayerSet: st.relayerSet,
        });
      })
      .then((pl) => live && setPlan(pl), (e) => live && setPlan({ error: errText(e) }));
    return () => void (live = false);
  }, [mode, w.safe, st, cap, base, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocker = !w.account || !w.safe
    ? "Connect your wallet and choose a Safe."
    : !st
      ? null
      : !st.inst.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase())
        ? "The connected wallet is not an owner of this Safe."
        : st.inst.threshold > 1
          ? `This Safe needs ${st.inst.threshold} owner signatures; one-signature install is for 1-of-1 Safes.`
          : GUARD_V3 && String(st.inst.raw?.guard ?? "").toLowerCase() === GUARD_V3.toLowerCase()
            ? "This Safe runs Fengce guard v3 (Tilt-shield and its other rules). This page adds Catalog circuits to guard v2 Safes for now, so nothing on this Safe is changed."
            : !set && st.inst.raw?.guard && String(st.inst.raw.guard) !== ZERO && !st.inst.guardOn
            ? `This Safe runs another guard (${short(String(st.inst.raw.guard))}). Install Fengce from Limits first, where replacing it is confirmed.`
            : null;

  const steps: { label: string; call: { to: Address; data: Hex; operation: 0 | 1 }; value: bigint; calls: Call[] }[] = [];
  if (mode === "remove") {
    const c = removeTickCall();
    steps.push({ label: "Schedule the removal", call: { to: c.to, data: c.data, operation: 0 }, value: 0n, calls: [c] });
  } else if (plan && !("error" in plan)) {
    if (plan.batch.length) steps.push({ label: plan.schedule ? "Pay and set up" : "Sign and add", call: multiSend(plan.batch), value: plan.value, calls: plan.batch });
    if (plan.schedule) steps.push({ label: "Schedule the change", call: { to: plan.schedule.to, data: plan.schedule.data, operation: 0 }, value: 0n, calls: [plan.schedule] });
  }

  async function sign() {
    if (!w.account || !w.safe) return;
    setMsg(null);
    const txs: Hex[] = [];
    try {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        setBusy(steps.length > 1 ? `Signature ${i + 1} of ${steps.length}: confirm in your wallet` : "Confirm in your wallet");
        const sim = await simulateSafeTx(w.account, w.safe, s.call, s.value);
        if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
        const r = await sendFromWallet(w.safe, sim.data, undefined, s.value || undefined);
        if (r.status !== "success") throw new Error("The transaction reverted on chain.");
        txs.push(r.hash);
      }
      setDone({
        text: mode === "remove" ? "Removal scheduled. Apply it on My wallet after the 1-day wait." : set ? "Scheduled. It applies after the 1-day wait: Apply on My wallet." : `Added. Your Safe now runs ${p.name}.`,
        txs,
      });
      onDone();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const designerCut = (row.entry.installFee * 8000n) / 10000n;
  const field = (label: string, v: string, on: (s: string) => void, bad: boolean, hint?: ReactNode) => (
    <label className="cat-f">
      <span className="small">{label}</span>
      <input className="field num" style={{ width: 140 }} inputMode="decimal" value={v} onChange={(e) => on(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={bad} />
      {hint}
    </label>
  );

  return createPortal(
    <div className="csheet-bg" onClick={() => !busy && onClose()}>
      <div className="csheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <span className="lbl">{mode === "remove" ? "Remove from" : "Add to"} Safe {w.safe ? short(w.safe) : ""}</span>
          <button type="button" className="alink" onClick={onClose} disabled={!!busy}>Close</button>
        </div>
        <h2 id="sheet-t" className="disp" style={{ fontSize: 30 }}>{p.name}</h2>
        <span className="small">
          Circuit <a className="code-link mono" href={circuitHref(CIRCUIT.catalog)}>#{String(row.id)}</a> · {p.stateful ? "stateful, through Tick" : "stateless"} · {row.entry.tier} tier
        </span>

        {mode === "remove" ? (
          <p className="body" style={{ fontSize: 15 }}>Your Safe stops running this circuit. Removing is a loosening, so it waits 1 day in public: sign now to schedule it, then Apply on My wallet when the wait is over.</p>
        ) : (
          <>
            <div className="cat-sec">
              <span className="lbl">What it does</span>
              <span className="body" style={{ fontSize: 15 }}>{p.description}</span>
            </div>

            {(usesCap(p) || p.stateful) && (
              <div className="cat-sec">
                <span className="lbl">Your values</span>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {usesCap(p) && field("Cap (USDT0)", cap, setCap, capN === null)}
                  {p.stateful && (
                    <label className="cat-f">
                      <span className="small">Period (resets at its start)</span>
                      <select className="field" style={{ width: 140 }} value={String(period)} onChange={(e) => setPeriod(BigInt(e.target.value))}>
                        {PERIODS.map(([l, s]) => <option key={l} value={String(s)}>{l}</option>)}
                      </select>
                    </label>
                  )}
                  {needsBase && field("Max per buy (USDT0)", base, setBase, baseN === null)}
                </div>
                {needsBase && <span className="small">Your Safe has no Fengce yet. The guard needs one stateless limit as its base, so this also sets max per buy (circuit #2); Tick runs the budget next to it.</span>}
                {replaces && (
                  <label className="cat-ack">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                    <span>
                      Switch off <b>{occupant}</b>. Your Safe has one Tick slot for a stateful rule, and {p.name} takes it {set ? "when the change applies (after 1 day)" : "now"}.
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="cat-sec">
              <span className="lbl">Install fee</span>
              {row.entry.installFee > 0n ? (
                <span className="body" style={{ fontSize: 15 }}>
                  {fee(row.entry.installFee)} once: {formatEther(designerCut)} OKB (80%) to the designer {short(row.entry.designer)}, {formatEther(row.entry.installFee - designerCut)} OKB (20%) to the Fengce treasury.
                </span>
              ) : (
                <span className="body" style={{ fontSize: 15 }}>Free during launch: 0 OKB. When a listing sets a fee, Catalog.payInstall splits it 80% to the designer ({short(row.entry.designer)}) and 20% to the Fengce treasury.</span>
              )}
            </div>
          </>
        )}

        {steps.length > 0 && (
          <div className="cat-sec">
            <span className="lbl">{steps.length > 1 ? `${steps.length} signatures` : "One signature"}</span>
            {steps.map((s, i) => (
              <div key={i} className="ts-log">
                {steps.length > 1 && <span className="small" style={{ padding: "6px 0" }}>{i + 1}. {s.label}</span>}
                {s.calls.map((c, k) => (
                  <div key={k} className="ts-lr" style={{ gridTemplateColumns: "24px minmax(0, 1fr) auto" }}>
                    <span className="num muted" style={{ fontSize: 12 }}>{k + 1}</span>
                    <span style={{ fontSize: 13.5 }}>{c.label}</span>
                    <span className="mono muted" style={{ fontSize: 12 }}>{short(c.to)}</span>
                  </div>
                ))}
              </div>
            ))}
            {steps.length > 1 && <span className="small">Your Safe already runs Fengce, and the guard does not let a batch change its own settings: the fee and setup go first, then the change is scheduled. It applies after 1 day (Apply on My wallet).</span>}
            {steps.length === 1 && set && mode === "add" && <span className="small">Your Safe already runs Fengce, so the change is scheduled and applies after 1 day (Apply on My wallet).</span>}
          </div>
        )}
        {plan && "error" in plan && <span className="err">{plan.error}</span>}
        {blocker && <span className="err">{blocker}</span>}
        {msg && <span className="err">{msg}</span>}
        {done ? (
          <div className="cat-sec">
            <span className="mono" style={{ color: "var(--allow)", fontSize: 14 }}>{done.text}</span>
            <span className="small">
              {done.txs.map((t) => (
                <a key={t} className="alink accent" style={{ marginRight: 12 }} href={EXPLORER_TX(t)} target="_blank" rel="noreferrer noopener">tx {short(t)}</a>
              ))}
              <a className="alink" href={href("wallet", { safe: w.safe! })}>My wallet</a>
            </span>
          </div>
        ) : (
          <button type="button" className="pill accent big" disabled={!!busy || !!blocker || !st || steps.length === 0 || (replaces && !ack)} onClick={sign}>
            {busy ?? (!st ? "Reading your Safe…" : steps.length === 0 && !blocker && !(plan && "error" in plan) ? "Preparing the transaction…" : steps.length > 1 ? `Sign ${steps.length} transactions` : mode === "remove" ? "Sign to schedule the removal" : set ? "Sign to schedule" : row.entry.installFee > 0n ? `Pay ${fee(row.entry.installFee)} and add` : "Sign and add")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
