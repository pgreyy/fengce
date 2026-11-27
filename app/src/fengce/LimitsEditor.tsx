import { useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { FengceGuardArtifact } from "@fengce/sdk";
import { client } from "../lib/chain";
import { ENGINE, MAX_BUY_CIRCUIT, configureInput, installCalls, multiSend, type Limits } from "./engine";
import { PREPARED, readInstalled, usdt0, type Installed } from "./reads";
import { href, param, short } from "./ui";
import { V3, V3_DEFAULTS, scheduleCall, v3ChangeCalls, v3InstallCalls, type V3Settings } from "./v3";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "./wallet";

type Tpl = "cap" | "rate" | "quiet" | "hold" | "tilt";
const TEMPLATES: { key: Tpl; name: string; v3: boolean }[] = [
  { key: "cap", name: "Max per buy", v3: false },
  { key: "quiet", name: "Quiet hours (UTC)", v3: true },
  { key: "rate", name: "Trades per clock hour (UTC)", v3: false },
  { key: "hold", name: "Hold lock", v3: true },
  { key: "tilt", name: "Tilt-shield", v3: true },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const evalAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);

/** Runs the real max-per-buy circuit (processor 0x839b…74e #2) on chain: input bit 0 = over the cap, bit 1 = paying USDT0. */
async function testOnChain(amount: number, cap: number): Promise<{ allow: boolean; reason: string }> {
  const over = amount > cap ? 1 : 0;
  const input = `0x0${over | 2}` as Hex;
  const out = await client.readContract({ address: MAX_BUY_CIRCUIT.processor, abi: evalAbi, functionName: "eval", args: [MAX_BUY_CIRCUIT.id, input] });
  const allow = (parseInt(out.slice(2, 4) || "0", 16) & 1) === 1;
  return { allow, reason: allow ? "within your limits" : `over your max per buy of ${cap} USDT0` };
}

/** Quiet hours run on the same NAND circuit #2: input a = inside quiet hours, b = a buy; refused when both are 1. */
async function testQuiet(): Promise<{ allow: boolean; reason: string }> {
  const out = await client.readContract({ address: MAX_BUY_CIRCUIT.processor, abi: evalAbi, functionName: "eval", args: [MAX_BUY_CIRCUIT.id, "0x03"] });
  const allow = (parseInt(out.slice(2, 4) || "0", 16) & 1) === 1;
  return { allow, reason: allow ? "within your limits" : "a buy at 02:14 UTC is inside your quiet hours" };
}

/** Any amount above 0 with up to 2 decimals (USDT0 has 6; limits are set in cents). */
export function parseAmount(v: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/** Typed amount with a coarse slider beside it; the typed value is the source of truth. */
function AmountField({ id, value, onChange, max, label }: { id: string; value: number; onChange: (n: number) => void; max: number; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (parseAmount(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const bad = parseAmount(text) === null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          id={id}
          aria-label={label}
          aria-invalid={bad}
          className="field num"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "");
            setText(v);
            const n = parseAmount(v);
            if (n !== null) onChange(n);
          }}
          style={{ width: 140, fontSize: 18 }}
        />
        <span className="mono muted" style={{ fontSize: 13 }}>USDT0</span>
        <input type="range" aria-label={`${label} (slider)`} min={1} max={max} step={1} value={Math.min(max, Math.max(1, Math.round(value)))} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: "1 1 160px" }} />
      </div>
      {bad && <span className="err" style={{ fontSize: 13 }}>Enter an amount above 0, with at most 2 decimals.</span>}
    </div>
  );
}

export function LimitsEditor({ installed, onDone }: { installed: Installed | null; onDone?: (i: Installed) => void }) {
  const w = useWallet();
  const [tpl, setTpl] = useState<Tpl>(((["cap", "rate", "quiet", "hold", "tilt"] as string[]).includes(param("tpl") ?? "") ? param("tpl") : "cap") as Tpl);
  const [cap, setCap] = useState(installed?.maxPerBuy ? Math.round(Number(installed.maxPerBuy) / 1e4) / 100 : 50);
  const [perHour, setPerHour] = useState(installed?.trades?.perHour || 5);
  const [rateOn, setRateOn] = useState(true);
  const [testAmt, setTestAmt] = useState(80);
  const [test, setTest] = useState<{ allow: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: Hex } | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);
  const r0 = installed?.v3?.rules;
  const [quietOn, setQuietOn] = useState(r0 ? r0.quietOn : V3_DEFAULTS.quietOn);
  const [quietStart, setQuietStart] = useState(r0 ? r0.quietStart : V3_DEFAULTS.quietStart);
  const [quietEnd, setQuietEnd] = useState(r0 ? r0.quietEnd : V3_DEFAULTS.quietEnd);
  const [holdHours, setHoldHours] = useState(r0 ? r0.holdSeconds / 3600 : V3_DEFAULTS.holdHours);
  const [tiltOn, setTiltOn] = useState(r0 ? r0.tiltOn : V3_DEFAULTS.tiltOn);
  const [cooldown, setCooldown] = useState(r0 && r0.tiltCooldown ? r0.tiltCooldown / 3600 : V3_DEFAULTS.tiltCooldownHours);
  const [pretend, setPretend] = useState(false);

  useEffect(() => {
    let alive = true;
    const quiet = pretend && quietOn && (quietStart === quietEnd || (quietStart < quietEnd ? 2 >= quietStart && 2 < quietEnd : 2 >= quietStart || 2 < quietEnd));
    const t = setTimeout(
      () =>
        (quiet ? testQuiet() : testOnChain(testAmt, cap)).then(
          (r) => alive && setTest(r),
          () => alive && setTest(null),
        ),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [testAmt, cap, pretend, quietOn, quietStart, quietEnd]);

  const limits: Limits = { maxPerBuy: BigInt(Math.round(cap * 1e6)), tradesPerHour: rateOn ? perHour : 0 };
  const settings: V3Settings = { ...V3_DEFAULTS, maxPerBuy: limits.maxPerBuy, tradesPerHour: limits.tradesPerHour, quietOn, quietStart, quietEnd, holdHours, tiltOn, tiltCooldownHours: cooldown };
  const safe = w.safe;
  // new Safes get guard v3; Safes already on v2 keep v2 (moving needs the 2-day recovery)
  const isV3 = installed?.engine === "v3";
  const useV3 = !!V3 && (isV3 || !installed?.set);
  const inQuiet = (h: number) => quietOn && (quietStart === quietEnd || (quietStart < quietEnd ? h >= quietStart && h < quietEnd : h >= quietStart || h < quietEnd));
  const isOwner = !!(installed && w.account && installed.owners.some((o) => o.toLowerCase() === w.account!.toLowerCase()));
  const alreadySet = !!installed?.set;

  async function run(label: string, build: () => { to: Address; data: Hex; operation: 0 | 1 }) {
    setMsg(null);
    setBusy(label);
    try {
      if (!w.account || !safe) throw new Error("Connect your wallet and choose a Safe first.");
      const tx = build();
      const sim = await simulateSafeTx(w.account, safe, tx);
      if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
      const r = await sendFromWallet(safe, sim.data);
      if (r.status !== "success") throw new Error("The transaction reverted on chain.");
      const fresh = await readInstalled(safe);
      setMsg({ ok: true, text: label === "install" ? "Limits active" : "Change requested. It can apply after the 1-day wait.", tx: r.hash });
      onDone?.(fresh);
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const install = () => run("install", () => multiSend(useV3 ? v3InstallCalls(safe!, settings, PREPARED!) : installCalls(safe!, limits, PREPARED!)));

  /** v3: each change goes out directly when the guard accepts it now (it tightens), else it is scheduled (1 day). */
  async function changeV3() {
    setMsg(null);
    setBusy("change");
    try {
      if (!w.account || !safe || !installed?.v3 || !PREPARED) throw new Error("Connect your wallet and choose a Safe first.");
      const calls = v3ChangeCalls(safe, { maxPerBuy: installed.maxPerBuy, rules: installed.v3.rules }, settings, PREPARED);
      if (!calls.length) throw new Error("Nothing to change: these are your current limits.");
      const done: string[] = [];
      let last: Hex | undefined;
      for (const c of calls) {
        let sim = await simulateSafeTx(w.account, safe, { to: c.to, data: c.data, operation: 0 });
        let label = `${c.label}: applied now`;
        if (!sim.ok) {
          const sc = scheduleCall(c);
          sim = await simulateSafeTx(w.account, safe, { to: sc.to, data: sc.data, operation: 0 });
          if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
          label = `${c.label}: scheduled, applies after 1 day`;
        }
        const r = await sendFromWallet(safe, sim.data);
        if (r.status !== "success") throw new Error("The transaction reverted on chain.");
        done.push(label);
        last = r.hash;
      }
      const fresh = await readInstalled(safe);
      setMsg({ ok: true, text: done.join(" · "), tx: last });
      onDone?.(fresh);
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  const requestChange = () =>
    run("change", () => {
      const configure = encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "configure", args: [configureInput(limits, PREPARED!)] });
      const g = installed?.guard ?? ENGINE.guard;
      return { to: g, data: encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "scheduleAdmin", args: [g, configure] }), operation: 0 };
    });

  // a guard that is not Fengce: installing replaces it, so it needs an explicit confirm
  const rawGuard = String(installed?.raw?.guard ?? "0x0000000000000000000000000000000000000000");
  const otherGuard = !!installed && !installed.guardOn && !/^0x0{40}$/i.test(rawGuard) ? rawGuard : null;
  const blocker = !PREPARED
    ? "The limit circuits are not pinned on X Layer yet. Testing works; signing opens once they are."
    : !w.account
      ? "Connect your wallet to sign."
      : !safe
        ? "Choose your Safe first."
        : installed && !isOwner
          ? "The connected wallet is not an owner of this Safe."
          : installed && installed.threshold > 1
            ? `This Safe needs ${installed.threshold} owner signatures. One-signature install is for 1-of-1 Safes; use the Safe app for this one.`
            : installed && installed.guardOn && !installed.limitsPolicy && alreadySet
              ? "This Safe already runs a Fengce policy that the Limits page did not set."
              : otherGuard && !replaceOk
                ? "This Safe runs another guard. Confirm above to replace it with Fengce."
                : null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
        {TEMPLATES.map((t) => {
          const on = tpl === t.key;
          const val =
            t.key === "cap" ? `${cap} USDT0`
            : t.key === "rate" ? (rateOn ? String(perHour) : "off")
            : !useV3 ? "guard v3"
            : t.key === "quiet" ? (quietOn ? `${hh(quietStart)}–${hh(quietEnd)}` : "off")
            : t.key === "hold" ? (holdHours ? `${holdHours} h` : "off")
            : tiltOn ? "on" : "off";
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTpl(t.key)}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%", padding: `16px 0 16px ${on ? 12 : 0}px`, border: 0, borderBottom: "1px solid var(--line)", borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`, background: "none", fontSize: 17, textAlign: "left", transition: "padding .2s", color: !t.v3 || useV3 ? "var(--text)" : "var(--muted)" }}
            >
              <span>{t.name}</span>
              <span className="mono" style={{ fontSize: 13.5, color: "var(--muted)" }}>{val}</span>
            </button>
          );
        })}
      </div>
      <div style={{ flex: "999 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="lbl">{TEMPLATES.find((t) => t.key === tpl)!.name}</span>
          {tpl === "cap" && (
            <>
              <label htmlFor="cap" style={{ fontSize: 17 }}>
                No single buy or send over <span className="num">{cap} USDT0</span>
              </label>
              <AmountField id="cap" label="Max per buy" value={cap} onChange={setCap} max={500} />
              <span className="small">Counts what you pay in USDT0, on any app, through swaps, sends and approvals. Other tokens are not capped by this limit.</span>
            </>
          )}
          {tpl === "rate" && (
            <>
              <label htmlFor="rate" style={{ fontSize: 17 }}>
                At most <span className="num">{perHour}</span> swaps per clock hour (UTC)
              </label>
              <input id="rate" type="range" min={1} max={15} step={1} value={perHour} onChange={(e) => setPerHour(Number(e.target.value))} disabled={!rateOn} />
              <button type="button" className="chip" aria-pressed={rateOn} onClick={() => setRateOn(!rateOn)} style={{ alignSelf: "flex-start" }}>
                {rateOn ? "On" : "Off"}
              </button>
              <span className="small">A TapeOut counter circuit, run by Fengce's Tick contract. The count resets at the start of each clock hour (UTC).</span>
            </>
          )}
          {(tpl === "quiet" || tpl === "hold" || tpl === "tilt") && !useV3 && (
            <span className="small">
              This rule runs in Fengce guard v3. New Safes get v3 when they install limits; this Safe runs guard v2, and moving it to v3 is a guard change (2-day recovery, every owner).
            </span>
          )}
          {tpl === "quiet" && useV3 && (
            <>
              <span style={{ fontSize: 17 }}>No buys between these hours (UTC)</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select className="field" style={{ width: 110 }} value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))} aria-label="Quiet hours start (UTC)">
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
                <span className="muted">to</span>
                <select className="field" style={{ width: 110 }} value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))} aria-label="Quiet hours end (UTC)">
                  {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                </select>
                <button type="button" className="chip" aria-pressed={quietOn} onClick={() => setQuietOn(!quietOn)}>{quietOn ? "On" : "Off"}</button>
              </div>
              <span className="small">The guard computes "inside quiet hours" from the block time and feeds it to NAND circuit #2 with "is a buy"; the circuit refuses when both are 1. Sells and sends to yourself still work.</span>
            </>
          )}
          {tpl === "hold" && useV3 && (
            <>
              <span style={{ fontSize: 17 }}>A token you buy can't be sold or sent for</span>
              <select className="field" style={{ width: 160 }} value={holdHours} onChange={(e) => setHoldHours(Number(e.target.value))} aria-label="Hold lock">
                {[0, 1, 6, 24, 72, 168].map((h) => <option key={h} value={h}>{h === 0 ? "off" : h < 24 ? `${h} hours` : `${h / 24} days`}</option>)}
              </select>
              <span className="small">Counted from your last buy of that token; the check runs on NAND circuit #2.</span>
            </>
          )}
          {tpl === "tilt" && useV3 && (
            <>
              <span style={{ fontSize: 17 }}>Pause buys after 4 buys in the same half hour (UTC), or one buy over 3x your usual size</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="chip" aria-pressed={tiltOn} onClick={() => setTiltOn(!tiltOn)}>{tiltOn ? "On" : "Off"}</button>
                <span className="small">Paused for</span>
                <select className="field" style={{ width: 120 }} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} aria-label="Tilt-shield pause">
                  {[1, 6, 24].map((h) => <option key={h} value={h}>{h} hours</option>)}
                </select>
              </div>
              {installed?.v3?.tilt && (
                <span className="small" style={{ color: installed.v3.tilt.paused ? "var(--deny)" : undefined }}>
                  {installed.v3.tilt.paused ? `Tripped: buys are paused${installed.v3.tilt.resumesAt ? ` until ${new Date(installed.v3.tilt.resumesAt * 1000).toUTCString().slice(17, 22)} UTC` : ""}.` : `${installed.v3.tilt.count} of ${installed.v3.tilt.tripAt ?? 4} buys in this half hour.`}
                </span>
              )}
              <span className="small">
                Counter circuit #7 counts buys in each half hour and the Tilt-shield latch circuit holds the pause, both through Tick. <a className="alink accent" href={href("tilt-shield")}>See how it works</a>
              </span>
            </>
          )}
        </div>

        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">Test before you sign</span>
          <label htmlFor="test" style={{ fontSize: 17 }}>
            A buy of <span className="num">{testAmt} USDT0</span>
          </label>
          <AmountField id="test" label="Test amount" value={testAmt} onChange={setTestAmt} max={600} />
          <button type="button" className="chip" aria-pressed={pretend} disabled={!useV3 || !quietOn} style={{ alignSelf: "flex-start" }} onClick={() => setPretend(!pretend)} title={quietOn ? undefined : "Turn on quiet hours first"}>
            Pretend it's 02:14 UTC{pretend ? " · on" : ""}
          </button>
          <div className="result">
            <span className="mono" style={{ color: test ? (test.allow ? "var(--allow)" : "var(--deny)") : "var(--muted)" }}>{test ? (test.allow ? "ALLOWED" : "REFUSED") : "…"}</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>{test ? test.reason : "running the circuit on X Layer"}</span>
          </div>
          <span className="small">This runs the real pinned circuit on X Layer with your numbers (an eth_call; nothing is sent).</span>
        </div>

        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="kv"><span>Tightening a limit</span><span className="mono">{isV3 || useV3 ? "applies at once" : "waits 1 day (guard v2)"}</span></div>
          <div className="kv"><span>Loosening a limit</span><span className="mono">waits 1 day</span></div>
          <div className="kv"><span>Removing the guard</span><span className="mono">waits 2 days, every owner signs</span></div>
          <div className="kv"><span>Guard</span><span className="mono">{isV3 ? "FengceGuardV3" : installed?.engine === "v2" ? "FengceGuard (v2)" : useV3 ? "FengceGuardV3 on install" : "FengceGuard (v2)"}</span></div>
          {otherGuard && !alreadySet && (
            <label className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 8, color: "var(--text)" }}>
              <input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                This Safe already runs another guard ({otherGuard.slice(0, 6)}…{otherGuard.slice(-4)}). Installing Fengce replaces it. I want to replace it.
              </span>
            </label>
          )}
          {alreadySet ? (
            <>
              <span className="small" style={{ marginTop: 8 }}>
                Installed now: max per buy {usdt0(installed!.maxPerBuy)} USDT0{installed!.trades ? `, ${installed!.trades.perHour} swaps per clock hour (UTC)` : ""}.{" "}
                {isV3 ? "A change that tightens applies at once; one that loosens is scheduled on chain and applies after 1 day. Trades per hour is set at install." : "A change is scheduled on chain and can apply after 1 day. Guard v2 applies the same wait to tightening."}
              </span>
              <button type="button" className="pill solid big" style={{ alignSelf: "flex-start", marginTop: 10 }} disabled={!!blocker || !!busy} onClick={isV3 ? changeV3 : requestChange}>
                {busy ? "Confirm in your wallet" : isV3 ? "Apply changes" : "Request change"}
              </button>
            </>
          ) : (
            <button type="button" className="pill accent big" style={{ alignSelf: "flex-start", marginTop: 10 }} disabled={!!blocker || !!busy} onClick={install}>
              {busy ? "Confirm in your wallet" : "Install with one signature"}
            </button>
          )}
          {blocker && <span className="small" style={{ marginTop: 6 }}>{blocker}</span>}
          {msg && (
            <span className={msg.ok ? "mono" : "err"} style={{ fontSize: 14, marginTop: 6, color: msg.ok ? "var(--allow)" : undefined }}>
              {msg.text}
              {msg.tx && (
                <>
                  {" · "}
                  <a className="alink accent" href={EXPLORER_TX(msg.tx)} target="_blank" rel="noreferrer noopener">tx {short(msg.tx)}</a>
                </>
              )}
              {msg.ok && msg.text === "Limits active" && (
                <>
                  {" · "}
                  <a className="alink" href={href("wallet")}>Open my wallet</a>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
