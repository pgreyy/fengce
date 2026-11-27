// Limits → Add a circuit: one TapeOut circuit that is not in the Fengce Catalog. The row expands into its details, a
// live run, and the mapping step (one guard fact per input bit); Add opens a warning sheet, then pins and installs it.
import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Address, Hex } from "viem";
import { schemaHash, type SchemaFile } from "@fengce/sdk";
import { MEMORY_SET, cannotUse, describe, evalBits, memoryNote, stepBits, zeroState, type Circuit } from "./circuitIndex";
import { FACT_LABEL, NOT_WIRABLE, fingerprint, importPlan, importSchema, importStatefulPlan, pinFor, type Fact } from "./importInstall";
import { createSafe } from "./safes";
import { compareRules, currentRule, replaceSentence, ruleFromSchema, type Comparison } from "./ruleSummary";
import { parseAmount } from "./LimitsEditor";
import { multiSend, TOKENS } from "./engine";
import { PREPARED, type Installed } from "./reads";
import { Addr, href, openWallet, short } from "./ui";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "./wallet";

const KINDS: Fact["kind"][] = ["amountGt", "tokenIs", "toIs", "foreign", "agent", "one", "zero"];
const blank = (k: Fact["kind"]): Fact => (k === "amountGt" ? { kind: k, usdt0: "1" } : k === "tokenIs" ? { kind: k, token: "USDT0" } : k === "toIs" ? { kind: k, to: "" } : ({ kind: k } as Fact));

export function ImportRow({ c, inst, guard, agentExecutor, open, onToggle }: { c: Circuit; inst: Installed | null; guard: Address; agentExecutor: Address; open: boolean; onToggle: () => void }) {
  const w = useWallet();
  const why = cannotUse(c);
  const mem = c.nState > 0;
  const memBlocked = mem && !!inst?.set;
  const [creating, setCreating] = useState<string | null>(null);
  const newSafe = async () => {
    if (!w.account) return openWallet();
    setCreating("Confirm in your wallet");
    try {
      await createSafe(w.account);
      setCreating(null);
    } catch (e) {
      setCreating((e as Error).message.split("\n")[0]);
    }
  };
  const [facts, setFacts] = useState<Fact[]>(() => [...Array(Math.max(0, Math.min(8, c.nIn))).keys()].map((i) => blank(i === 0 ? "amountGt" : "tokenIs")));
  const [fp, setFp] = useState<Awaited<ReturnType<typeof fingerprint>> | null>(null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if ((open || sheet) && !fp && !why) fingerprint(c).then(setFp, () => setFp(null));
  }, [open, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  const schema = useMemo(() => (fp ? importSchema(c, fp.netlist, facts, agentExecutor) : null), [fp, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cmp, setCmp] = useState<Comparison | null>(null);
  useEffect(() => {
    setCmp(null);
    if (!schema || "error" in schema || c.nState) return;
    let live = true;
    compareRules(ruleFromSchema(schema, c.cpu, BigInt(c.id)), null, [agentExecutor]).then((x) => live && setCmp(x), () => live && setCmp(null));
    return () => void (live = false);
  }, [schema]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    if (!w.account || !w.safe) return openWallet();
    if (!open) onToggle();
    setSheet(true);
  };

  return (
    <Fragment>
      <div className={`cat-r cat-row${open ? " on" : ""}`} role="row" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), onToggle())}>
        <span className="cat-name">
          <span className="cat-t">
            {c.tape} <span className="tag n" style={{ marginLeft: 6 }}>UNLISTED</span>
          </span>
          <span className="cat-d">{describe(c)}</span>
        </span>
        <span className="mono" title={`Circuit #${c.id} on processor #${c.p} (${c.cpu})`}>#{c.id}</span>
        <span className="muted">{c.nState ? "Stateful" : "Stateless"}</span>
        <span className="mono muted" style={{ fontSize: 12.5 }}>{c.gates} gate{c.gates === 1 ? "" : "s"}</span>
        <span className="mono">No fee</span>
        <span className="mono muted" title={c.cpu}>#{c.p} {short(c.cpu)}</span>
        <span className="mono muted">not reviewed</span>
        <span className="r cat-act" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="pill line cat-add" disabled={!!why || memBlocked} title={why ?? (memBlocked ? MEMORY_SET : undefined)} onClick={add}>
            Add
          </button>
        </span>
      </div>
      {open && (
        <div className="cat-x" role="row">
          <div className="cat-x-l">
            <span className="lbl">This circuit</span>
            <span className="body" style={{ fontSize: 15 }}>
              {describe(c)}. {c.nIn} input bit{c.nIn === 1 ? "" : "s"}, {c.nOut} output bit{c.nOut === 1 ? "" : "s"}, {c.gates} gate{c.gates === 1 ? "" : "s"}
              {c.nState ? `, ${c.nState} state bits` : ""}. Output bit 0 decides: 1 allows, 0 refuses.
            </span>
            {mem && <span className="err" style={{ fontSize: 14 }}>{memoryNote(c)}</span>}
            {memBlocked && (
              <span className="small" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span>Your Safe {short(inst!.safe)} already has limits. {MEMORY_SET}</span>
                <button type="button" className="pill line" onClick={newSafe} disabled={creating === "Confirm in your wallet"}>{creating === "Confirm in your wallet" ? creating : "Create a new Safe"}</button>
                {creating && creating !== "Confirm in your wallet" && <span className="err" style={{ fontSize: 13 }}>{creating}</span>}
              </span>
            )}
            {why ? <span className="err" style={{ fontSize: 14 }}>{why}</span> : mem ? <LiveStep c={c} /> : <LiveRun c={c} />}
            <div className="addr-row"><span>Processor #{c.p}</span><Addr value={c.cpu} label="Copy processor address" /></div>
            {fp && (
              <>
                <div className="addr-row"><span>Netlist hash</span><Addr value={fp.netlistHash} n={6} label="Copy netlist hash" /></div>
                {fp.owner && <div className="addr-row"><span>Taped out by</span><Addr value={fp.owner} label="Copy owner address" /></div>}
              </>
            )}
          </div>
          {!why && (
            <div className="cat-x-r">
              <span className="lbl">Map its inputs to guard facts</span>
              {facts.map((f, i) => (
                <div key={i} className="imp-map">
                  <span className="mono muted">in{i}</span>
                  <select className="field" value={f.kind} onChange={(e) => setFacts((x) => x.map((y, k) => (k === i ? blank(e.target.value as Fact["kind"]) : y)))} aria-label={`Fact for input ${i}`}>
                    {KINDS.map((k) => <option key={k} value={k}>{FACT_LABEL[k]}</option>)}
                    <optgroup label="Not available as inputs (guard v3 runs these itself)">
                      {NOT_WIRABLE.map((n) => <option key={n} disabled>{n}</option>)}
                    </optgroup>
                  </select>
                  {f.kind === "amountGt" && <input className="field num" style={{ width: 110 }} inputMode="decimal" value={f.usdt0} onChange={(e) => setFacts((x) => x.map((y, k) => (k === i ? { ...f, usdt0: e.target.value.replace(/[^0-9.]/g, "") } : y)))} aria-label="Cap in USDT0" />}
                  {f.kind === "tokenIs" && (
                    <select className="field" style={{ width: 110 }} value={f.token} onChange={(e) => setFacts((x) => x.map((y, k) => (k === i ? { ...f, token: e.target.value as keyof typeof TOKENS } : y)))} aria-label="Token">
                      {Object.keys(TOKENS).map((t) => <option key={t} value={t}>{t === "WOKB" ? "OKB" : t}</option>)}
                    </select>
                  )}
                  {f.kind === "toIs" && <input className="field mono" style={{ width: 200 }} placeholder="0x…" value={f.to} onChange={(e) => setFacts((x) => x.map((y, k) => (k === i ? { ...f, to: e.target.value.trim() } : y)))} aria-label="Address" />}
                </div>
              ))}
              {schema && "error" in schema && <span className="err" style={{ fontSize: 14 }}>{schema.error}</span>}
              {schema && !("error" in schema) && (mem ? <StepPreview c={c} facts={facts} /> : <Preview c={c} facts={facts} />)}
              {cmp?.neverRefuses && <span className="imp-warn"><b>With this mapping the circuit never refuses anything; your Safe would have no limit.</b> The facts you wired cannot both be true in one transaction (for example an amount cap in USDT0 with "token paid is USDC").</span>}
              {cmp?.neverAllows && <span className="imp-warn"><b>With this mapping the circuit never allows anything:</b> every transaction from your Safe would be refused.</span>}
              {cmp && !cmp.neverRefuses && !cmp.neverAllows && cmp.comparable && <span className="small" style={{ color: "var(--text)" }}>With this mapping your Safe {cmp.next}.</span>}
              <span className="small">Quiet hours, hold lock, agent caps and Tilt-shield are decided by guard v3 on its own circuits; they cannot be wired into another circuit.</span>
            </div>
          )}
        </div>
      )}
      {sheet && schema && !("error" in schema) && fp && <ImportSheet c={c} schema={schema} facts={facts} fp={fp} inst={inst} guard={guard} agentExecutor={agentExecutor} onClose={() => setSheet(false)} />}
      {sheet && (!schema || "error" in schema || !fp) && <StubSheet onClose={() => setSheet(false)} text={!fp ? "Reading the circuit from X Layer…" : schema && "error" in schema ? `Finish the mapping first: ${schema.error}` : "Map its inputs first."} />}
    </Fragment>
  );
}

/** Toggle the input bits and run the circuit on chain (eth_call). */
function LiveRun({ c }: { c: Circuit }) {
  const [bits, setBits] = useState<number[]>(() => Array(c.nIn).fill(0));
  const [out, setOut] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    setOut(null);
    evalBits(c, bits).then((o) => live && setOut(o), () => live && setOut(null));
    return () => void (live = false);
  }, [bits]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className="small">Run it:</span>
      {bits.map((b, i) => (
        <button key={i} type="button" className="chip" aria-pressed={b === 1} onClick={() => setBits((x) => x.map((y, k) => (k === i ? 1 - y : y)))}>
          in{i} = {b}
        </button>
      ))}
      <span className={`tag ${out ? (out[0] ? "g" : "r") : "n"}`}>{out ? `out = ${out.join("")} · ${out[0] ? "ALLOW" : "REFUSE"}` : "…"}</span>
    </div>
  );
}

/** A circuit with memory: toggle the inputs and step it from its current state (read-only step; nothing is stored). */
function LiveStep({ c }: { c: Circuit }) {
  const [bits, setBits] = useState<number[]>(() => Array(c.nIn).fill(0));
  const [state, setState] = useState<Hex>(() => zeroState(c));
  const [last, setLast] = useState<{ out: number[]; from: Hex; to: Hex } | null>(null);
  const run = () => stepBits(c, state, bits).then((r) => (setLast({ out: r.out, from: state, to: r.state }), setState(r.state)), () => setLast(null));
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className="small">Run it:</span>
      {bits.map((b, i) => (
        <button key={i} type="button" className="chip" aria-pressed={b === 1} onClick={() => setBits((x) => x.map((y, k) => (k === i ? 1 - y : y)))}>
          in{i} = {b}
        </button>
      ))}
      <button type="button" className="chip" onClick={run}>Step</button>
      <button type="button" className="alink" onClick={() => (setState(zeroState(c)), setLast(null))}>Reset memory</button>
      <span className="mono small">memory {state}</span>
      {last && <span className={`tag ${last.out[0] ? "g" : "r"}`}>{`out = ${last.out.join("")} · ${last.out[0] ? "ALLOW" : "REFUSE"}`}</span>}
    </div>
  );
}

/** Three transactions in a row in one period, with the mapping (wired facts as "no"), stepped live. */
function StepPreview({ c, facts }: { c: Circuit; facts: Fact[] }) {
  const [rows, setRows] = useState<boolean[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    (async () => {
      const bits = facts.map((f) => (f.kind === "one" ? 1 : 0));
      let st = zeroState(c);
      const out: boolean[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await stepBits(c, st, bits);
        out.push(r.out[0] === 1);
        st = r.state;
      }
      return out;
    })().then((r) => live && setRows(r), () => live && setRows(null));
    return () => void (live = false);
  }, [JSON.stringify(facts)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ts-log" style={{ marginTop: 6 }}>
      {(rows ?? []).map((a, i) => (
        <div key={i} className="ts-lr" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <span style={{ fontSize: 13.5 }}>Transaction {i + 1} in a period{facts.some((f) => f.kind !== "one" && f.kind !== "zero") ? " (wired facts: no)" : ""}</span>
          <span className={`tag ${a ? "g" : "r"}`}>{a ? "ALLOW" : "REFUSE"}</span>
        </div>
      ))}
      {!rows && <span className="small">Stepping it on X Layer…</span>}
      <span className="small">Tick resets the memory at the start of each period you choose.</span>
    </div>
  );
}

/** Every combination of the wired facts, run live: what the Safe would decide. */
function Preview({ c, facts }: { c: Circuit; facts: Fact[] }) {
  const wired = facts.map((f, i) => ({ f, i })).filter((x) => x.f.kind !== "one" && x.f.kind !== "zero");
  const [rows, setRows] = useState<{ label: string; allow: boolean }[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    if (wired.length > 3) return;
    Promise.all(
      [...Array(1 << wired.length).keys()].map(async (m) => {
        const bits: number[] = facts.map((f) => (f.kind === "one" ? 1 : 0));
        wired.forEach((x, k) => (bits[x.i] = (m >> k) & 1));
        const o = await evalBits(c, bits);
        return { label: wired.map((x, k) => `${FACT_LABEL[x.f.kind].toLowerCase()} = ${(m >> k) & 1 ? "yes" : "no"}`).join(", "), allow: o[0] === 1 };
      }),
    ).then((r) => live && setRows(r), () => live && setRows(null));
    return () => void (live = false);
  }, [JSON.stringify(facts)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (wired.length > 3) return <span className="small">Too many wired inputs to list every case here.</span>;
  return (
    <div className="ts-log" style={{ marginTop: 6 }}>
      {(rows ?? []).map((r) => (
        <div key={r.label} className="ts-lr" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
          <span style={{ fontSize: 13.5 }}>{r.label}</span>
          <span className={`tag ${r.allow ? "g" : "r"}`}>{r.allow ? "ALLOW" : "REFUSE"}</span>
        </div>
      ))}
      {!rows && <span className="small">Running every case on X Layer…</span>}
    </div>
  );
}

function StubSheet({ text, onClose }: { text: string; onClose: () => void }) {
  return createPortal(
    <div className="csheet-bg" onClick={onClose}>
      <div className="csheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="lbl">Add a circuit</span>
          <button type="button" className="alink" onClick={onClose}>Close</button>
        </div>
        <span className="body">{text}</span>
      </div>
    </div>,
    document.body,
  );
}

/** Warning, fingerprint, the mapping, then pin and install. */
function ImportSheet({ c, schema, facts, fp, inst, guard, agentExecutor, onClose }: { c: Circuit; schema: SchemaFile; facts: Fact[]; fp: Awaited<ReturnType<typeof fingerprint>>; inst: Installed | null; guard: Address; agentExecutor: Address; onClose: () => void }) {
  const w = useWallet();
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState(false);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  useEffect(() => {
    if (c.nState) return;
    let live = true;
    (inst?.set ? currentRule(inst.safe, inst.guard) : Promise.resolve(null))
      .then((cur) => compareRules(ruleFromSchema(schema, c.cpu, BigInt(c.id)), cur, [agentExecutor]))
      .then((x) => live && setCmp(x), () => live && setCmp(null));
    return () => void (live = false);
  }, [inst?.safe, inst?.set]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pin, setPin] = useState<{ pinId: Hex; exists: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; txs: Hex[] } | null>(null);
  const set = !!inst?.set;
  useEffect(() => {
    if (w.account) pinFor(c, schema, w.account).then(setPin, (e) => setMsg((e as Error).message.split("\n")[0]));
  }, [w.account]); // eslint-disable-line react-hooks/exhaustive-deps
  const mem = c.nState > 0;
  const [period, setPeriod] = useState<bigint>(86_400n);
  const [base, setBase] = useState("5");
  const baseN = parseAmount(base);
  const plan = useMemo(() => {
    if (!pin || !w.safe || !inst || !PREPARED) return null;
    try {
      return mem
        ? importStatefulPlan({ safe: w.safe, circuit: c, schema, pinId: pin.pinId, pinned: pin.exists, fengceSet: set, period, baseMaxPerBuy: BigInt(Math.round((baseN ?? 0) * 1e6)), prepared: PREPARED })
        : importPlan({ safe: w.safe, circuit: c, schema, pinId: pin.pinId, pinned: pin.exists, fengceSet: set, guard, prepared: PREPARED });
    } catch {
      return null;
    }
  }, [pin, w.safe, inst, period, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocker = !w.account || !w.safe ? "Connect your wallet and choose a Safe." : !inst ? "Reading your Safe…" : mem && set ? MEMORY_SET : mem && baseN === null ? "Enter a max per buy above 0." : !inst.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase()) ? "The connected wallet is not an owner of this Safe." : inst.threshold > 1 ? `This Safe needs ${inst.threshold} owner signatures.` : !set && inst.raw?.guard && !/^0x0{40}$/i.test(String(inst.raw.guard)) && !inst.guardOn ? "This Safe runs another guard; install Fengce from Limits first." : !PREPARED ? "The limit circuits are not pinned yet." : null;
  const sigs = plan ? (plan.ownerPin ? 1 : 0) + 1 : 0;

  async function sign() {
    if (!w.account || !w.safe || !plan) return;
    setMsg(null);
    const txs: Hex[] = [];
    try {
      if (plan.ownerPin) {
        setBusy("Pin it: confirm in your wallet");
        const r = await sendFromWallet(plan.ownerPin.to, plan.ownerPin.data);
        if (r.status !== "success") throw new Error("Pinning reverted.");
        txs.push(r.hash);
      }
      const tx = plan.schedule ? { to: plan.schedule.to, data: plan.schedule.data, operation: 0 as const } : multiSend(plan.batch);
      setBusy(plan.schedule ? "Schedule it: confirm in your wallet" : "Confirm in your wallet");
      const sim = await simulateSafeTx(w.account, w.safe, tx);
      if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
      const r = await sendFromWallet(w.safe, sim.data);
      if (r.status !== "success") throw new Error("The transaction reverted on chain.");
      txs.push(r.hash);
      setDone({ text: plan.schedule ? "Pinned and scheduled: it becomes your policy after the wait (Apply on My wallet)." : `Pinned and installed: your Safe now runs ${c.tape} as its policy, with guard v3.`, txs });
    } catch (e) {
      setMsg((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return createPortal(
    <div className="csheet-bg" onClick={() => !busy && onClose()}>
      <div className="csheet" role="dialog" aria-modal="true" aria-labelledby="imp-t" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span className="lbl">Add to Safe {w.safe ? short(w.safe) : ""}</span>
          <button type="button" className="alink" onClick={onClose} disabled={!!busy}>Close</button>
        </div>
        <h2 id="imp-t" className="disp" style={{ fontSize: 30 }}>{c.tape}</h2>
        <div className="imp-warn">
          <b>Unlisted: not reviewed by its designer or Fengce.</b> Anyone can tape out a circuit. Check what it does below before you rely on it; Fengce only checks that the code
          does not change after you pin it.
        </div>
        <div className="cat-sec">
          <span className="lbl">Code fingerprint</span>
          <div className="addr-row"><span>Processor #{c.p}</span><Addr value={c.cpu} label="Copy processor address" /></div>
          <div className="addr-row"><span>Circuit</span><span className="mono" style={{ fontSize: 13 }}>#{c.id} · {c.gates} gates · {describe(c)}</span></div>
          <div className="addr-row"><span>Netlist hash</span><Addr value={fp.netlistHash} n={6} label="Copy netlist hash" /></div>
          {fp.cpuCodehash && <div className="addr-row"><span>Processor code hash</span><Addr value={fp.cpuCodehash} n={6} label="Copy code hash" /></div>}
          <div className="addr-row"><span>Schema hash</span><Addr value={schemaHash(schema)} n={6} label="Copy schema hash" /></div>
        </div>
        <div className="cat-sec">
          <span className="lbl">Your mapping</span>
          {facts.map((f, i) => (
            <span key={i} className="small" style={{ color: "var(--text)" }}>
              in{i}: {FACT_LABEL[f.kind]}
              {f.kind === "amountGt" ? ` ${f.usdt0} USDT0` : f.kind === "tokenIs" ? ` ${f.token === "WOKB" ? "OKB" : f.token}` : f.kind === "toIs" ? ` ${short(f.to)}` : ""}
            </span>
          ))}
          <span className="small">No install fee: unlisted circuits are not in the Catalog.</span>
        </div>
        {mem && (
          <div className="cat-sec">
            <span className="lbl">Its memory</span>
            <span className="small">{memoryNote(c)} Tick keeps it for your Safe and resets it at the start of each period.</span>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label className="cat-f">
                <span className="small">Period (memory resets at its start)</span>
                <select className="field" style={{ width: 140 }} value={String(period)} onChange={(e) => setPeriod(BigInt(e.target.value))}>
                  {([["1 hour", 3_600n], ["1 day", 86_400n], ["1 week", 604_800n]] as [string, bigint][]).map(([l, v]) => <option key={l} value={String(v)}>{l}</option>)}
                </select>
              </label>
              <label className="cat-f">
                <span className="small">Max per buy (USDT0)</span>
                <input className="field num" style={{ width: 140 }} inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^0-9.]/g, ""))} aria-invalid={baseN === null} />
              </label>
            </div>
            <span className="small">The guard needs one stateless limit as its base, so this also sets max per buy (circuit #2); Tick runs this circuit next to it.</span>
          </div>
        )}
        {plan && (
          <div className="cat-sec">
            <span className="lbl">{sigs === 1 ? "One signature" : `${sigs} signatures`}</span>
            <div className="ts-log">
              {[...(plan.ownerPin ? [plan.ownerPin] : []), ...(plan.schedule ? [plan.schedule] : plan.batch)].map((x, k) => (
                <div key={k} className="ts-lr" style={{ gridTemplateColumns: "24px minmax(0, 1fr) auto" }}>
                  <span className="num muted" style={{ fontSize: 12 }}>{k + 1}</span>
                  <span style={{ fontSize: 13.5 }}>{x.label}</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>{short(x.to)}</span>
                </div>
              ))}
            </div>
            <span className="small">
              {set
                ? `Your Safe already runs Fengce: ${plan.ownerPin ? "your wallet pins the circuit, then " : "the circuit is pinned already; "}the Safe schedules the change. It applies after the wait (1 day, 7 with a partner), like any loosening, and you can cancel it until then.`
                : mem
                  ? "Your Safe has no guard yet: one batch pins the circuit, sets up its memory on Tick and installs guard v3 (Tilt-shield on)."
                  : "Your Safe has no guard yet: one batch pins the circuit and installs guard v3 with it as the policy (Tilt-shield on). Tightening later applies at once; loosening waits 1 day."}
            </span>
          </div>
        )}
        {cmp && (
          <div className="cat-sec">
            <span className="lbl">What changes</span>
            <span className="body" style={{ fontSize: 15 }}>{replaceSentence(cmp)}</span>
            {cmp.looser && <span className="imp-warn"><b>Looser than now:</b> {cmp.looser}.</span>}
          </div>
        )}
        {cmp?.neverRefuses && (
          <label className="cat-ack">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span>With this mapping the circuit never refuses anything; your Safe would have no limit. I want to add it anyway.</span>
          </label>
        )}
        <label className="cat-ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I checked what this circuit does. It is not reviewed by its designer or by Fengce.</span>
        </label>
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
          <button type="button" className="pill accent big" disabled={!ack || !!blocker || !plan || !!busy || (!!cmp?.neverRefuses && !override) || (!c.nState && !cmp)} onClick={sign}>
            {busy ?? (!plan ? "Preparing…" : plan.schedule ? (plan.ownerPin ? "Pin, then schedule" : "Schedule the change") : plan.batch[0]?.label.startsWith("Pin") ? "Pin and install" : "Install")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
