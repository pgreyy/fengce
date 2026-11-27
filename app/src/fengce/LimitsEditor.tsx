import { useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { FengceGuardArtifact } from "@fengce/sdk";
import { client } from "../lib/chain";
import { ENGINE, MAX_BUY_CIRCUIT, configureInput, installCalls, multiSend, type Limits } from "./engine";
import { PREPARED, readInstalled, usdt0, type Installed } from "./reads";
import { href, short } from "./ui";
import { EXPLORER_TX, sendFromWallet, simulateSafeTx, useWallet } from "./wallet";

type Tpl = "cap" | "rate" | "quiet" | "hold" | "tilt";
const TEMPLATES: { key: Tpl; name: string; live: boolean }[] = [
  { key: "cap", name: "Max per buy", live: true },
  { key: "quiet", name: "Quiet hours", live: false },
  { key: "rate", name: "Trades per clock hour (UTC)", live: true },
  { key: "hold", name: "Hold lock", live: false },
  { key: "tilt", name: "Tilt-shield", live: false },
];
const evalAbi = parseAbi(["function eval(uint256 id, bytes input) view returns (bytes)"]);

/** Runs the real max-per-buy circuit (processor 0x839b…74e #2) on chain: input bit 0 = over the cap, bit 1 = paying USDT0. */
async function testOnChain(amount: number, cap: number): Promise<{ allow: boolean; reason: string }> {
  const over = amount > cap ? 1 : 0;
  const input = `0x0${over | 2}` as Hex;
  const out = await client.readContract({ address: MAX_BUY_CIRCUIT.processor, abi: evalAbi, functionName: "eval", args: [MAX_BUY_CIRCUIT.id, input] });
  const allow = (parseInt(out.slice(2, 4) || "0", 16) & 1) === 1;
  return { allow, reason: allow ? "within your limits" : `over your max per buy of ${cap} USDT0` };
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
  const [tpl, setTpl] = useState<Tpl>("cap");
  const [cap, setCap] = useState(installed?.maxPerBuy ? Math.round(Number(installed.maxPerBuy) / 1e4) / 100 : 50);
  const [perHour, setPerHour] = useState(installed?.trades?.perHour || 5);
  const [rateOn, setRateOn] = useState(true);
  const [testAmt, setTestAmt] = useState(80);
  const [test, setTest] = useState<{ allow: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: Hex } | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => testOnChain(testAmt, cap).then((r) => alive && setTest(r), () => alive && setTest(null)), 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [testAmt, cap]);

  const limits: Limits = { maxPerBuy: BigInt(Math.round(cap * 1e6)), tradesPerHour: rateOn ? perHour : 0 };
  const safe = w.safe;
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

  const install = () => run("install", () => multiSend(installCalls(safe!, limits, PREPARED!)));
  const requestChange = () =>
    run("change", () => {
      const configure = encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "configure", args: [configureInput(limits, PREPARED!)] });
      return { to: ENGINE.guard, data: encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "scheduleAdmin", args: [ENGINE.guard, configure] }), operation: 0 };
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
          const val = t.key === "cap" ? `${cap} USDT0` : t.key === "rate" ? (rateOn ? String(perHour) : "off") : "coming soon";
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTpl(t.key)}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%", padding: `16px 0 16px ${on ? 12 : 0}px`, border: 0, borderBottom: "1px solid var(--line)", borderLeft: `2px solid ${on ? "var(--accent)" : "transparent"}`, background: "none", fontSize: 17, textAlign: "left", transition: "padding .2s", color: t.live ? "var(--text)" : "var(--muted)" }}
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
          {(tpl === "quiet" || tpl === "hold") && (
            <span className="small">
              {tpl === "quiet" ? "No trades in the hours you pick." : "A token can't leave your wallet for the days you pick."} This limit needs a time fact the current engine
              does not give circuits. It arrives with the next Fengce guard.
            </span>
          )}
          {tpl === "tilt" && (
            <span className="small">
              Sells-only after a burst of buys. <a className="alink accent" href={href("tilt-shield")}>See how it works</a>
            </span>
          )}
        </div>

        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="lbl">Test before you sign</span>
          <label htmlFor="test" style={{ fontSize: 17 }}>
            A buy of <span className="num">{testAmt} USDT0</span>
          </label>
          <AmountField id="test" label="Test amount" value={testAmt} onChange={setTestAmt} max={600} />
          <button type="button" className="chip" disabled style={{ alignSelf: "flex-start", opacity: 0.5 }} title="Quiet hours arrive with the next engine release">
            Pretend it's 02:14 · coming soon
          </button>
          <div className="result">
            <span className="mono" style={{ color: test ? (test.allow ? "var(--allow)" : "var(--deny)") : "var(--muted)" }}>{test ? (test.allow ? "ALLOWED" : "REFUSED") : "…"}</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>{test ? test.reason : "running the circuit on X Layer"}</span>
          </div>
          <span className="small">This runs the real pinned circuit on X Layer with your numbers (an eth_call; nothing is sent).</span>
        </div>

        <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="kv"><span>Changing a limit</span><span className="mono">waits 1 day</span></div>
          <div className="kv"><span>Removing the guard</span><span className="mono">waits 2 days, every owner signs</span></div>
          <div className="kv"><span>Partner approval</span><span className="mono muted">coming soon</span></div>
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
                Installed now: max per buy {usdt0(installed!.maxPerBuy)} USDT0{installed!.trades ? `, ${installed!.trades.perHour} swaps per clock hour (UTC)` : ""}. A change is scheduled
                on chain and can apply after 1 day. Today the engine applies the same wait to tightening.
              </span>
              <button type="button" className="pill solid big" style={{ alignSelf: "flex-start", marginTop: 10 }} disabled={!!blocker || !!busy} onClick={requestChange}>
                {busy ? "Confirm in your wallet" : "Request change"}
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
