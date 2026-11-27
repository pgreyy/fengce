import { useEffect, useState } from "react";
import { PRODUCT_NAME, REPO, TAPE_NAME } from "../brand";
import { DEPLOYMENT, EXPLORER } from "../lib/chain";
import DEWEB from "../../../deployments/deweb-xlayer-196.json";
import TILT_LATCH from "../../../contracts/circuits/tilt-latch.json";
import M2 from "../../../deployments/m2-demo-xlayer-196.json";
import { keccak256 } from "viem";
const TILT_LATCH_HASH = keccak256(TILT_LATCH.netlist as `0x${string}`);
import { MAX_BUY_CIRCUIT, COUNTER } from "../fengce/engine";
import { PREPARED } from "../fengce/reads";
import { IncidentGrid } from "../fengce/incidents";
import { Ruled, type Tone } from "../fengce/Ruled";
import { Addr, CIRCUIT, CodeCard, circuitHref, mount, oldHref, param, short } from "../fengce/ui";

type Tab = "how" | "inc" | "cmp" | "devs" | "contracts" | "circuits" | "judges";
const TABS: [Tab, string][] = [
  ["how", "How it works"],
  ["inc", "Incidents"],
  ["cmp", "Compared"],
  ["devs", "For developers"],
  ["contracts", "Contracts"],
  ["circuits", "Circuits"],
  ["judges", "For judges"],
];

const CMP_COLS = ["Coinbase CDP, Privy, Turnkey", "Hypernative (Safe Shield)", "MetaMask Delegation, Zodiac Roles", "Fengce"];
const CMP: [string, ...[string, Tone][]][] = [
  ["Who runs the check", ["The vendor's enclave", "m"], ["A service plus a Safe guard", "m"], ["On-chain contract", "g"], ["On chain, a public TapeOut circuit", "g"]],
  ["Company in the middle", ["Yes", "b"], ["Yes", "b"], ["No", "g"], ["No", "g"]],
  ["Can the rule change quietly", ["Yes, instantly via API", "b"], ["Through a dashboard", "b"], ["Owner can change it", "b"], ["No: loosening waits 1 day in public", "g"]],
  ["Other contracts can check it", ["No", "b"], ["No", "b"], ["No", "b"], ["Yes, isBound", "g"]],
  ["Works on the wallet you already have", ["No, their wallet", "b"], ["Safe only", "m"], ["Their account types", "m"], ["Safe; 6900 enforced", "g"]],
  ["Rule format", ["Their JSON rules", "m"], ["Their policies", "m"], ["Fixed caveat types", "m"], ["Any TapeOut circuit", "g"]],
];
const USES = [
  ["Spending limits", "Caps per buy and per hour. What the Limits page sets."],
  ["Approved recipients only", "Funds can only go to addresses on a pinned list."],
  ["No unlimited approvals", "Token approvals must stay under a set amount."],
  ["Swaps return to the wallet", "A swap's output must land back in this wallet, size capped."],
  ["Shared team budget", "One budget per period across several wallets and agents."],
  ["Company floor", "A company-wide cap teams can tighten, never loosen."],
  ["Agent allowances", "Caps for the agents acting on one Safe."],
  ["Your own circuit", "Design any TapeOut circuit, list it with test vectors; when you set an install fee, you earn 80% of it (listings are free during launch)."],
];
const STEPS = [
  ["01", "Bind", "FengceGuard is installed on your Safe as its transaction guard and module guard. Nothing moves; you keep your wallet and keys.", "FengceGuard · SafeAdmin"],
  ["02", "Pin", "Your limit's circuit and every processor it depends on are fingerprinted, including the code behind them. If any of it changes, the check fails safe.", "PinRegistry"],
  ["03", "Check", "Each transaction is turned into facts (kind, recipient, token, amount) and run through the pinned circuit before it executes.", "PolicyEngine · decoders"],
  ["04", "Settle", "Optional on Safe: what actually left the wallet is checked again after execution, and any break reverts the whole transaction.", "Inspector · X Layer"],
];

/** Safes with a FengceGuard configuration: Configured events, from the snapshot at once, then the live history. */
/** Milestone 2 on X Layer mainnet: every transaction of the guard v3 demo, from deployments/m2-demo-xlayer-196.json. */
function M2Txs() {
  const t = M2.txs as unknown as Record<string, { hash: string }[]>;
  const rows: [string, string, string][] = [
    ["FengceGuardV3 deployed", t.deploy[5].hash, "deployed"],
    ["Tilt-shield latch circuit taped out and pinned", t.deploy[3].hash, `circuit #${M2.tiltLatchCircuitId}`],
    ["Guard v3 installed on the demo Safe, one signature", t.safe[1].hash, "installed"],
    ["Swap 0.2 USDT0 → OKB", t.swap[0].hash, "ALLOWED"],
    ["Swap 3 USDT0 → OKB, recorded with recordRefusal", t.refuse[0].hash, "REFUSED · CIRCUIT"],
    ...t.tilt.map((x, i) => [`Tilt-shield buy ${i + 1} of 4 (0.2 USDT0), same half hour`, x.hash, i === 3 ? "ALLOWED · trips" : "ALLOWED"] as [string, string, string]),
    ["One more buy, recorded with recordRefusal", t.paused[0].hash, "REFUSED · TILT_SHIELD"],
    ["OKX Agentic Wallet pays 0.3 USDT0 through AgentExecutorV3", t.agent[0].hash, "ALLOWED"],
    ["Same agent pays 0.3 USDT0 again", t.agent[1].hash, "DENIED · AGENT_CAP"],
    ...(t.hold?.length === 3
      ? ([
          ["Hold lock 6 hours, then buy 0.05 USDT0", t.hold[1].hash, "ALLOWED"],
          ["Sell it right away, recorded with recordRefusal", t.hold[2].hash, "REFUSED · HOLD_LOCK"],
        ] as [string, string, string][])
      : []),
    ...(t.quiet?.length === 2 ? ([["A buy inside quiet hours, recorded with recordRefusal", t.quiet[1].hash, "REFUSED · QUIET_HOURS"]] as [string, string, string][]) : []),
    ...(t.partner?.length ? ([["Partner scheduled (a loosening: waits 1 day)", t.partner[0].hash, "scheduled"]] as [string, string, string][]) : []),
    ...(t.setup ? ([["FengceSetupV3 deployed: Safe creation with guard v3 in one signature", t.setup[0].hash, "deployed"]] as [string, string, string][]) : []),
    ...(t.fresh ? ([["Second Safe created with guard v3 in one transaction", t.fresh[0].hash, "installed"]] as [string, string, string][]) : []),
    ...(t.catalog?.length === 5
      ? ([
          ["Catalog #2 install scheduled (free during launch)", t.catalog[0].hash, "installed"],
          ["Partner approves the change early", t.catalog[1].hash, "installed"],
          ["Catalog circuit applied as the policy", t.catalog[2].hash, "installed"],
          ["Send 0.05 USDT0", t.catalog[3].hash, "ALLOWED"],
          ["Send 0.5 USDT0, recorded with recordRefusal", t.catalog[4].hash, "REFUSED · CIRCUIT"],
        ] as [string, string, string][])
      : []),
    ...(t.build?.length === 8
      ? ([
          [`Build your own circuit taped out (#${M2.buildCircuitId} on #180)`, t.build[1].hash, `circuit #${M2.buildCircuitId}`],
          ["Pinned, scheduled, approved early, applied", t.build[5].hash, "installed"],
          ["Send 0.05 USDT0", t.build[6].hash, "ALLOWED"],
          ["Send 0.5 USDT0, recorded with recordRefusal", t.build[7].hash, "REFUSED · CIRCUIT"],
        ] as [string, string, string][])
      : []),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="lbl">Milestones 2 and 2c on X Layer mainnet · guard v3 · {rows.length} transactions</span>
      {rows.map(([what, h, res]) => (
        <div key={h} className="addr-row">
          <span>{what}</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a className="code-link mono" style={{ fontSize: 13 }} href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer noopener">{short(h, 6)}</a>
            <span className={`tag ${res.startsWith("ALLOWED") ? "g" : res === "deployed" || res === "installed" || res === "scheduled" || res.startsWith("circuit") ? "n" : "r"}`}>{res}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Installs() {
  const rows = useInstalls(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="lbl">Installs read from chain{rows ? ` · ${rows.length}` : ""}</span>
      {!rows && <span className="small">Reading FengceGuard Configured events…</span>}
      {rows?.map((r) => (
        <div key={r.safe} className="addr-row">
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Addr value={r.safe} link={`${EXPLORER}/address/${r.safe}`} label="Copy Safe address" />
            <a className="alink" href={`../wallet/?safe=${r.safe}`}>Open</a>
          </span>
          <span className="small">
            installed at block {Number(r.block).toLocaleString("en-US")} · <a className="code-link mono" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer noopener">{short(r.tx)}</a>
          </span>
        </div>
      ))}
      <span className="small">New testers: <a className="alink" href="../onboard/">onboarding</a>.</span>
    </div>
  );
}

function useInstalls(on: boolean) {
  const [rows, setRows] = useState<{ safe: string; tx: string; block: string }[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const pick = (events: { source: string; event: string; safe: string | null; tx: string; block: string }[]) => {
      const seen = new Map<string, { safe: string; tx: string; block: string }>();
      for (const e of events) if (e.source === "guard" && e.event === "Configured" && e.safe && !seen.has(e.safe.toLowerCase())) seen.set(e.safe.toLowerCase(), { safe: e.safe, tx: e.tx, block: e.block });
      return [...seen.values()].sort((a, b) => Number(BigInt(b.block) - BigInt(a.block)));
    };
    (async () => {
      const { loadSnapshot } = await import("../fengce/reads");
      const { syncHistory } = await import("../lib/events");
      const snap = await loadSnapshot();
      if (live && snap) setRows(pick(snap.events as never));
      const h = await syncHistory(snap);
      if (live) setRows(pick(h.events as never));
    })().catch(() => undefined);
    return () => void (live = false);
  }, [on]);
  return rows;
}

function Docs() {
  const [tab, setTab] = useState<Tab>((TABS.find(([k]) => k === param("tab"))?.[0] as Tab) ?? "how");
  // links like /docs/?tab=circuits#c-6-2-180 open the tab and scroll to that circuit
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
    return () => clearTimeout(t);
  }, [tab]);
  const c = DEPLOYMENT.contracts as Record<string, string>;
  const addrs: [string, string][] = [
    ["Network", "X Layer mainnet · chain 196"],
    ...["FengceGuard", "PinRegistry", "PolicyEngine", "Tick", "Catalog", "AgentExecutor", "FengceBinding", "FengceInspector", "UniswapV3RouterDecoder"].map((k) => [k, c[k]] as [string, string]),
    ["Max per buy circuit", `${short(MAX_BUY_CIRCUIT.processor)} #${MAX_BUY_CIRCUIT.id} (NAND)`],
    ["Trades per hour circuit", PREPARED ? `${short(PREPARED.counterProcessor)} #${PREPARED.counterCircuitId} (${COUNTER.gates} NAND + ${COUNTER.latches} LATCH)` : `${COUNTER.gates} NAND + ${COUNTER.latches} LATCH, taped out on processor #180 (pending)`],
    ["Catalog circuits", "0x839b…74e #2 · 0xF9bB…a0F #7 · 0xB04E…3FF #5 · 0xE2a6…cd7 #18 · 0x87BF…9a6 #52"],
    ["Demo Safe (release v2)", DEPLOYMENT.demoSafe],
    ["FengceGuardV3 (Milestone 2)", M2.guard],
    ["AgentExecutorV3", M2.agentExecutor],
    ["FengceRulesV3 library", M2.rulesLibrary],
    ["Demo Safe (guard v3)", M2.safe],
    ["Milestone 1 acceptance Safe", "0x5641DA334011832Feec997875781a3D40239465e"],
    ["TapeOut features used", `Circuits (eval, step with LATCH state through Tick), PinRegistry over REF closures, DeWeb (${TAPE_NAME})`],
    ["FengceSetupV3", M2.setupV3],
    ["All addresses", "deployments/xlayer-196-v2.json (v2, Sourcify exact match) · deployments/m2-demo-xlayer-196.json (v3, on Sourcify: guard match, the others exact match)"],
    ["Repo", REPO.replace("https://", "")],
  ];
  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 48 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
          <span className="lbl">Docs</span>
          <h1 className="disp" style={{ fontSize: 50 }}>
            Wallet rules that <em>can't be swapped</em>
          </h1>
          <p className="body" style={{ color: "var(--text)" }}>Fengce binds TapeOut circuits to the smart wallet you already have and checks every transaction against them.</p>
          <p className="body">Any wallet, app or agent platform can use the same engine.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Section">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "how" && (
        <>
          <div className="cols-m" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", borderTop: "1px solid var(--line)" }}>
            {STEPS.map(([n, t, d, code], i) => (
              <div key={n} style={{ padding: "22px 22px 22px 0", paddingLeft: i ? 22 : 0, borderLeft: i ? "1px solid var(--line)" : undefined, display: "flex", flexDirection: "column", gap: 10 }}>
                <span className="lbl">{n}</span>
                <span className="disp" style={{ fontSize: 26 }}>{t}</span>
                <span className="small">{d}</span>
                <span className="mono" style={{ fontSize: 12 }}>{code}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 40 }}>
            <div>
              <span className="lbl" style={{ display: "block", paddingBottom: 12 }}>What we promise</span>
              {[["Rules run on chain, before money moves", "enforced"], ["The circuit can't be swapped under you", "pinned"], ["Loosening waits 1 day, in public", "timelocked"], ["Other contracts can check your binding", "isBound"]].map(([a, b]) => (
                <div className="kv" key={a}><span>{a}</span><span className="mono allow" style={{ fontSize: 12.5 }}>{b}</span></div>
              ))}
            </div>
            <div>
              <span className="lbl" style={{ display: "block", paddingBottom: 12 }}>What we can't promise</span>
              {[["Wallets without Fengce installed", "not protected"], ["Plain EOAs, 7702 and embedded wallets", "use a Safe"], ["6900 wallets", "enforced, not permanent"], ["TapeOut factory upgrades", "watched off chain"]].map(([a, b]) => (
                <div className="kv" key={a}><span>{a}</span><span className="mono muted" style={{ fontSize: 12.5 }}>{b}</span></div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span className="lbl">Use cases</span>
            <p className="body" style={{ maxWidth: 720 }}>The Limits page uses Fengce for personal limits. The same engine runs any rule a TapeOut circuit can express.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", borderTop: "1px solid var(--line)" }}>
              {USES.map(([t, d], i) => (
                <div key={t} style={{ padding: "22px 20px 22px 0", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="lbl">{String(i + 1).padStart(2, "0")}</span>
                  <span className="disp" style={{ fontSize: 21 }}>{t}</span>
                  <span className="small">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "inc" && (
        <>
          <p className="body" style={{ maxWidth: 720 }}>Real losses where every transaction looked valid. What failed each time was the rule, not the signature. The last card is an everyday example, not a reported incident.</p>
          <IncidentGrid />
        </>
      )}

      {tab === "cmp" && (
        <>
          <p className="body" style={{ maxWidth: 720 }}>Others enforce rules too. Fengce is the one where the rule is a public circuit on chain and loosening it waits 1 day in public.</p>
          <Ruled cols={CMP_COLS} rows={CMP} label="Fengce compared with other enforcement tools" />
        </>
      )}

      {tab === "devs" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 32, alignItems: "start" }}>
            <CodeCard title="check before your user signs" code={'npm i @fengce/sdk\n\nconst v = await preSign(client, rule, safe, tx)\n// "allow" | "deny"'} />
            <CodeCard title="in your contract" code={"require(binding.isBound(user, POLICY, 1 days));"} />
          </div>
          <div>
            <span className="lbl" style={{ display: "block", paddingBottom: 12 }}>Wallet support</span>
            <div className="scroll-x">
              <table className="rt stk" style={{ minWidth: 560 }}>
                <thead>
                  <tr><th>Wallet</th><th>Enforced</th><th>Permanence (isBound)</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {[["Safe", "yes", "yes", "guard on owner and module paths"], ["Alchemy MA v2 (6900)", "yes", "not yet", "hook"], ["EOA, 7702, embedded", "no", "no", "move funds to a Safe"]].map(([a, b, cc, d]) => (
                    <tr key={a}>
                      <td className="rowhead">{a}</td>
                      <td data-label="Enforced" className="mono" style={{ fontSize: 13, color: b === "yes" ? "var(--allow)" : "var(--muted)" }}>{b}</td>
                      <td data-label="Permanence" className="mono" style={{ fontSize: 13, color: cc === "yes" ? "var(--allow)" : "var(--muted)" }}>{cc}</td>
                      <td data-label="Notes" className="muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
            <span className="lbl">Roadmap · wallet integrations</span>
            <span style={{ fontSize: 17 }}>Limits shown inside the wallet itself</span>
            <span className="small">A wallet such as OKX Wallet could read a user's limits with the SDK and show them on its confirm screen, before the user signs.</span>
          </div>
        </>
      )}

      {tab === "contracts" && (
        <div>
          <p className="body" style={{ maxWidth: 720, marginBottom: 18 }}>Release v2 on X Layer mainnet (chain 196). Every contract is verified on Sourcify (exact match); the full manifest with salts, init code hashes and constructor arguments is in deployments/manifest-xlayer-196-v2.json.</p>
          {Object.entries(c).map(([name, addr]) => (
            <div key={name} className="addr-row">
              <span>{name}</span>
              <span style={{ display: "inline-flex", gap: 12, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <Addr value={addr} link={`${EXPLORER}/address/${addr}`} label={`Copy ${name} address`} />
                <a className="alink" href={`https://repo.sourcify.dev/196/${addr}`} target="_blank" rel="noreferrer noopener">Sourcify</a>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "circuits" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <p className="body" style={{ maxWidth: 720 }}>Each limit is a TapeOut circuit. PinRegistry fingerprints the circuit, every processor it depends on and the code behind them; if any of it changes, the check fails closed.</p>
          <div id={CIRCUIT.maxBuy} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>Max per buy · circuit #{String(MAX_BUY_CIRCUIT.id)}</span>
            <div className="addr-row"><span>Processor</span><Addr value={MAX_BUY_CIRCUIT.processor} link={`${EXPLORER}/address/${MAX_BUY_CIRCUIT.processor}`} label="Copy processor address" /></div>
            <div className="addr-row"><span>Circuit</span><span className="mono" style={{ fontSize: 13 }}>#{String(MAX_BUY_CIRCUIT.id)} · NAND(amount over cap, paying USDT0)</span></div>
            <div className="addr-row"><span>Also decides (guard v3)</span><span className="small">Quiet hours, hold lock and agent caps: allow = NAND(rule applies, condition), same circuit and pin</span></div>
            {PREPARED && <div className="addr-row"><span>Pin</span><Addr value={PREPARED.maxBuyPin} n={6} label="Copy pin id" /></div>}
          </div>
          <div id={CIRCUIT.counter} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>Trades per clock hour (UTC) · circuit #{PREPARED ? PREPARED.counterCircuitId : "7"}</span>
            {PREPARED && <div className="addr-row"><span>Processor #180</span><Addr value={PREPARED.counterProcessor} link={`${EXPLORER}/address/${PREPARED.counterProcessor}`} label="Copy processor address" /></div>}
            <div className="addr-row"><span>Circuit</span><span className="mono" style={{ fontSize: 13 }}>{COUNTER.gates} NAND + {COUNTER.latches} LATCH, run by Tick</span></div>
            {PREPARED &&
              Object.entries(PREPARED.counterPins).map(([n, pinId]) => (
                <div key={n} className="addr-row"><span>Pin, {n} per hour</span><Addr value={pinId} n={6} label={`Copy pin for ${n} per hour`} /></div>
              ))}
          </div>
          <div id={CIRCUIT.tiltLatch} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>Tilt-shield latch · guard v3</span>
            <div className="addr-row"><span>Circuit</span><span className="mono" style={{ fontSize: 13 }}>{TILT_LATCH.gates} NAND + {TILT_LATCH.latches} LATCH · inputs isBuy, trip, clear · state paused</span></div>
            <div className="addr-row"><span>Netlist hash</span><Addr value={TILT_LATCH_HASH} n={6} label="Copy netlist hash" /></div>
            <div className="addr-row"><span>Processor #180</span><span className="small">taped out with guard v3 (circuits/tilt-latch.json, checked on every input and state)</span></div>
            <div className="addr-row"><span>Count in the window</span><a className="code-link mono" style={{ fontSize: 13 }} href={circuitHref(CIRCUIT.counter)}>counter circuit #7, Tick period: each half hour (UTC)</a></div>
          </div>
          <div id={CIRCUIT.deweb} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>{TAPE_NAME} · this site on X Layer</span>
            <div className="addr-row"><span>Name</span><span className="mono" style={{ fontSize: 13 }}>circuit #6 · area 2 · processor #180, served by TapeOut DeWeb</span></div>
            <div className="addr-row"><span>Processor #180</span><Addr value={DEWEB.processor} link={`${EXPLORER}/address/${DEWEB.processor}`} label="Copy processor address" /></div>
            <div className="addr-row"><span>Site container</span><Addr value={DEWEB.container} link={`${EXPLORER}/address/${DEWEB.container}`} label="Copy container address" /></div>
            <div className="addr-row"><span>Open it</span><a className="code-link mono" style={{ fontSize: 13 }} href="https://6-2-180.tapekit.org/" target="_blank" rel="noreferrer noopener">6-2-180.tapekit.org</a></div>
            <div className="addr-row"><span>Earlier version</span><a className="code-link mono" style={{ fontSize: 13 }} href={oldHref()}>/old/ · the site as first published on {TAPE_NAME}, archived</a></div>
          </div>
          <div id={CIRCUIT.catalog} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>Catalog circuits</span>
            <div className="addr-row"><span>Listed</span><span className="mono" style={{ fontSize: 13 }}>0x839b…74e #2 · 0xF9bB…a0F #7 · 0xB04E…3FF #5 · 0xE2a6…cd7 #18 · 0x87BF…9a6 #52</span></div>
            <div className="addr-row"><span>For designers</span><span className="small" style={{ fontSize: 13.5 }}>List your circuit in the Catalog (Catalog.list with test vectors, checked on chain; see <a className="code-link" href="https://github.com/pgreyy/fengce/blob/main/docs/INTEGRATION.md" target="_blank" rel="noreferrer noopener">INTEGRATION.md</a>) for the Catalog badge. Listings are free during launch; when you set an install fee, Catalog.payInstall sends 80% to you and 20% to the Fengce treasury. Any other TapeOut circuit can still be imported on Limits, marked Unlisted.</span></div>
          </div>
        </div>
      )}

      {tab === "judges" && <Installs />}

      {tab === "judges" && <M2Txs />}

      {tab === "judges" && (
        <div>
          {addrs.map(([a, b]) => (
            <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{a}</span>
              {/^0x[0-9a-fA-F]{40}$/.test(b) ? (
                <Addr value={b} link={`${EXPLORER}/address/${b}`} label={`Copy ${a} address`} />
              ) : a === "Max per buy circuit" || a === "Trades per hour circuit" ? (
                <a className="mono code-link" style={{ fontSize: 13 }} href={circuitHref(a === "Max per buy circuit" ? CIRCUIT.maxBuy : CIRCUIT.counter)}>{b}</a>
              ) : (
                <span className="mono" style={{ fontSize: 13, color: "var(--muted)", overflowWrap: "anywhere" }} title={b}>{b}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

mount("docs", 1, <Docs />);
