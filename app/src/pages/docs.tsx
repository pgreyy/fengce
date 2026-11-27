import { useEffect, useState } from "react";
import { PRODUCT_NAME, REPO, TAPE_NAME } from "../brand";
import { DEPLOYMENT, EXPLORER } from "../lib/chain";
import DEWEB from "../../../deployments/deweb-xlayer-196.json";
import { MAX_BUY_CIRCUIT, COUNTER } from "../okun/engine";
import { PREPARED } from "../okun/reads";
import { IncidentGrid } from "../okun/incidents";
import { Ruled, type Tone } from "../okun/Ruled";
import { Addr, CIRCUIT, CodeCard, circuitHref, mount, param, short } from "../okun/ui";

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
  ["Works on the wallet you already have", ["No, their wallet", "b"], ["Safe only", "m"], ["Their account types", "m"], ["Safe; 7579 and 6900 enforced", "g"]],
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
  ["Your own circuit", "Design any TapeOut circuit, list it with test vectors, earn 80% of install fees."],
];
const STEPS = [
  ["01", "Bind", "FengceGuard is installed on your Safe as its transaction guard and module guard. Nothing moves; you keep your wallet and keys.", "FengceGuard · SafeAdmin"],
  ["02", "Pin", "Your limit's circuit and every processor it depends on are fingerprinted, including the code behind them. If any of it changes, the check fails safe.", "PinRegistry"],
  ["03", "Check", "Each transaction is turned into facts (kind, recipient, token, amount) and run through the pinned circuit before it executes.", "PolicyEngine · decoders"],
  ["04", "Settle", "Optional on Safe: what actually left the wallet is checked again after execution, and any break reverts the whole transaction.", "Inspector · X Layer"],
];

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
    ["Demo Safe", DEPLOYMENT.demoSafe],
    ["TapeOut features used", `Circuits (eval, step with LATCH state through Tick), PinRegistry over REF closures, DeWeb (${TAPE_NAME})`],
    ["All addresses", "deployments/xlayer-196-v2.json · Sourcify, exact match"],
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
              {[["Wallets without Fengce installed", "not protected"], ["Plain EOAs, 7702 and embedded wallets", "use a Safe"], ["7579 and 6900 wallets", "enforced, not permanent"], ["TapeOut factory upgrades", "watched off chain"]].map(([a, b]) => (
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
                  {[["Safe", "yes", "yes", "guard on owner and module paths"], ["Kernel, Nexus, Etherspot (7579)", "yes", "not yet", "the hook can be uninstalled on some"], ["Alchemy MA v2 (6900)", "yes", "not yet", "hook"], ["EOA, 7702, embedded", "no", "no", "move funds to a Safe"]].map(([a, b, cc, d]) => (
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
          <div id={CIRCUIT.deweb} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>{TAPE_NAME} · this site on X Layer</span>
            <div className="addr-row"><span>Name</span><span className="mono" style={{ fontSize: 13 }}>circuit #6 · area 2 · processor #180, served by TapeOut DeWeb</span></div>
            <div className="addr-row"><span>Processor #180</span><Addr value={DEWEB.processor} link={`${EXPLORER}/address/${DEWEB.processor}`} label="Copy processor address" /></div>
            <div className="addr-row"><span>Site container</span><Addr value={DEWEB.container} link={`${EXPLORER}/address/${DEWEB.container}`} label="Copy container address" /></div>
            <div className="addr-row"><span>Open it</span><a className="code-link mono" style={{ fontSize: 13 }} href="https://6-2-180.tapekit.org/" target="_blank" rel="noreferrer noopener">6-2-180.tapekit.org</a></div>
          </div>
          <div id={CIRCUIT.catalog} className="anchor">
            <span className="lbl" style={{ display: "block", paddingBottom: 8 }}>Catalog circuits</span>
            <div className="addr-row"><span>Listed</span><span className="mono" style={{ fontSize: 13 }}>0x839b…74e #2 · 0xF9bB…a0F #7 · 0xB04E…3FF #5 · 0xE2a6…cd7 #18 · 0x87BF…9a6 #52</span></div>
          </div>
        </div>
      )}

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
