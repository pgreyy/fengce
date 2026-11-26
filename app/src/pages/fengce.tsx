import { useState } from "react";
import { PRODUCT_NAME, REPO, TAPE_NAME } from "../brand";
import { DEPLOYMENT } from "../lib/chain";
import { MAX_BUY_CIRCUIT, COUNTER } from "../okun/engine";
import { PREPARED } from "../okun/reads";
import { CodeCard, mount, param, short } from "../okun/ui";

type Tab = "how" | "inc" | "cmp" | "uses" | "agents" | "devs" | "judges";
const TABS: [Tab, string][] = [
  ["how", "How it works"],
  ["inc", "Real incidents"],
  ["cmp", "Compared"],
  ["uses", "Use cases"],
  ["agents", "For agents"],
  ["devs", "For developers"],
  ["judges", "For judges"],
];

const INCIDENTS = [
  { name: "Binance", loss: "~$6.3B", date: "Oct 2026", src: "https://socradar.io/blog/binance-hack-6-3b-hot-wallet-theft/", host: "socradar.io", what: "An attacker took over the internal signing service and drained hot wallets.", why: "Every withdrawal carried a valid signature, so nothing looked wrong.", fengce: "Plain key wallets can't be limited on chain. Held in Fengce-guarded Safes, an outflow limit would have capped each transfer, and raising it would have waited 1 day in public." },
  { name: "Bybit", loss: "~$1.5B", date: "Feb 2025", src: "https://blocksec.com/blog/bybit-incident-a-web2-breach-enables-the-largest-crypto-hack-in-history", host: "blocksec.com", what: "The Safe screen showed a normal transfer while signers approved a contract upgrade.", why: "Signers trusted what the interface showed them.", fengce: "FengceGuard refuses that kind of call outright (a delegatecall upgrade), and changes to the wallet's setup wait in public." },
  { name: "Freysa", loss: "$47K", date: "Nov 2024", src: "https://www.theblock.co/post/328747/human-player-outwits-freysa-ai-agent-in-47000-crypto-challenge", host: "theblock.co", what: 'A player talked an AI agent out of its "never send funds" rule.', why: "The only rule lived in the agent's prompt.", fengce: "The circuit doesn't read prompts." },
  { name: "AIXBT", loss: "~$106K", date: "Mar 2025", src: "https://www.theblock.co/post/346911/ai-crypto-bot-aixbt-lost-eth-hack-unauthorized-dashboard-access", host: "theblock.co", what: "An attacker got into the agent's dashboard and queued transfers.", why: "Whoever controls the dashboard controls the agent.", fengce: "Over-limit transfers revert, and loosening the rule waits 1 day in public." },
];

type Tone = "g" | "m" | "b";
const tone = (t: Tone) => (t === "g" ? "var(--allow)" : t === "b" ? "var(--deny)" : "var(--muted)");
const CMP_COLS = ["Coinbase CDP, Privy, Turnkey", "Hypernative (Safe Shield)", "MetaMask Delegation, Zodiac Roles", "Fengce"];
const CMP: [string, ...[string, Tone][]][] = [
  ["Who runs the check", ["The vendor's enclave", "m"], ["A service plus a Safe guard", "m"], ["On-chain contract", "g"], ["On chain, a public TapeOut circuit", "g"]],
  ["Company in the middle", ["Yes", "b"], ["Yes", "b"], ["No", "g"], ["No", "g"]],
  ["Can the rule change quietly", ["Yes, instantly via API", "b"], ["Through a dashboard", "b"], ["Owner can change it", "b"], ["No: loosening waits 1 day in public", "g"]],
  ["Other contracts can check it", ["No", "b"], ["No", "b"], ["No", "b"], ["Yes, isBound", "g"]],
  ["Works on the wallet you already have", ["No, their wallet", "b"], ["Safe only", "m"], ["Their account types", "m"], ["Safe; 7579 and 6900 enforced", "g"]],
  ["Rule format", ["Their JSON rules", "m"], ["Their policies", "m"], ["Fixed caveat types", "m"], ["Any TapeOut circuit", "g"]],
];
const AGENT_COLS = ["Prompt rules", "Wallet warnings", "Vendor policy", "Fengce"];
const AGENT: [string, ...[string, Tone][]][] = [
  ["Agent talked out of its rule (Freysa)", ["Bypassed", "b"], ["No human reads them", "b"], ["Blocked if set", "m"], ["Blocked: the circuit doesn't read prompts", "g"]],
  ["Agent dashboard hijacked (AIXBT)", ["Bypassed", "b"], ["Not involved", "m"], ["Blocked unless the policy admin is reached too", "m"], ["Blocked, and loosening waits 1 day in public", "g"]],
  ["Vendor servers down or hacked", ["n/a", "m"], ["n/a", "m"], ["Exposed", "b"], ["Not affected: no vendor in the loop", "g"]],
];
const USES = [
  ["Spending limits", `Caps per buy and per hour. What ${PRODUCT_NAME} uses.`],
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

function Ruled({ cols, rows, label }: { cols: string[]; rows: [string, ...[string, Tone][]][]; label: string }) {
  return (
    <div className="scroll-x">
      <table className="rt" aria-label={label} style={{ minWidth: 760 }}>
        <thead>
          <tr>
            <th />
            {cols.map((c, i) => (
              <th key={c} style={i === cols.length - 1 ? { color: "var(--accent)" } : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, ...cells]) => (
            <tr key={k}>
              <td style={{ color: "var(--text)" }}>{k}</td>
              {cells.map(([t, tn], i) => (
                <td key={i} style={{ fontSize: 14, color: tone(tn), fontWeight: i === cells.length - 1 ? 500 : 400 }}>{t}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fengce() {
  const [tab, setTab] = useState<Tab>((TABS.find(([k]) => k === param("tab"))?.[0] as Tab) ?? "how");
  const c = DEPLOYMENT.contracts as Record<string, string>;
  const addrs: [string, string][] = [
    ["Network", "X Layer mainnet · chain 196"],
    ...["FengceGuard", "PinRegistry", "PolicyEngine", "Tick", "Catalog", "AgentExecutor", "FengceBinding", "FengceInspector", "UniswapV3RouterDecoder"].map((k) => [k, c[k]] as [string, string]),
    ["Max per buy circuit", `${MAX_BUY_CIRCUIT.processor} #${MAX_BUY_CIRCUIT.id} (NAND)`],
    ["Trades per hour circuit", PREPARED ? `${PREPARED.counterProcessor} #${PREPARED.counterCircuitId} (${COUNTER.gates} NAND + ${COUNTER.latches} LATCH)` : `${COUNTER.gates} NAND + ${COUNTER.latches} LATCH, taped out on processor #180 (pending)`],
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
          <span className="lbl">Fengce · the engine</span>
          <h1 className="disp" style={{ fontSize: 50 }}>
            Wallet rules that <em>can't be swapped</em>
          </h1>
          <p className="body" style={{ color: "var(--text)" }}>Fengce binds TapeOut circuits to the smart wallet you already have and checks every transaction against them.</p>
          <p className="body">{PRODUCT_NAME} is one product built on it. Any wallet, app or agent platform can use the same engine.</p>
        </div>
        <div className="tabs" role="tablist" aria-label="Section">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "how" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", borderTop: "1px solid var(--line)" }}>
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
        </>
      )}

      {tab === "inc" && (
        <>
          <p className="body" style={{ maxWidth: 720 }}>Four real losses where every transaction looked valid. What failed each time was the rule, not the signature.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", columnGap: 40, borderTop: "1px solid var(--line)" }}>
            {INCIDENTS.map((x) => (
              <article key={x.name} style={{ padding: "24px 0", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span className="disp" style={{ fontSize: 28 }}>{x.name}</span>
                  <span className="num deny" style={{ fontSize: 24 }}>{x.loss}</span>
                </div>
                <span className="mono small">
                  {x.date} · <a href={x.src} target="_blank" rel="noreferrer noopener" style={{ textDecoration: "underline" }}>{x.host}</a>
                </span>
                <div><span className="lbl" style={{ display: "block" }}>What happened</span><span>{x.what}</span></div>
                <div><span className="lbl" style={{ display: "block" }}>Why it worked</span><span>{x.why}</span></div>
                <div style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 14 }}><span className="lbl accent" style={{ display: "block" }}>With Fengce</span><span>{x.fengce}</span></div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === "cmp" && (
        <>
          <p className="body" style={{ maxWidth: 720 }}>Others enforce rules too. Fengce is the one where the rule is a public circuit on chain and loosening it waits 1 day in public.</p>
          <Ruled cols={CMP_COLS} rows={CMP} label="Fengce compared with other enforcement tools" />
        </>
      )}

      {tab === "uses" && (
        <>
          <p className="body" style={{ maxWidth: 720 }}>{PRODUCT_NAME} uses Fengce for personal limits. The same engine runs any rule a TapeOut circuit can express.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", borderTop: "1px solid var(--line)" }}>
            {USES.map(([t, d], i) => (
              <div key={t} style={{ padding: "22px 20px 22px 0", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="lbl">{String(i + 1).padStart(2, "0")}</span>
                <span className="disp" style={{ fontSize: 21 }}>{t}</span>
                <span className="small">{d}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "agents" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="lbl">When an AI agent goes wrong</span>
            <Ruled cols={AGENT_COLS} rows={AGENT} label="AI agent failure scenarios compared" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 40, alignItems: "start" }}>
            <div style={{ borderTop: "1px solid var(--line)" }}>
              {[
                ["The agent signs, the wallet decides", "Give the agent a key on a bound Safe through AgentExecutor. Every payment or trade it makes passes your limits first."],
                ["Agents check before they sign", "The Fengce MCP server and SDK answer allow or deny, with the reason, before anything is sent."],
                ["An agent can't loosen its own limits", "Only the Safe's owners can schedule a change, and it waits 1 day like any other."],
                ["Per-agent limits", "Separate daily caps for each agent key on the same Safe: next engine release."],
                ["Works with agent wallets you already run", "For example the OKX Agentic Wallet as the agent key on a bound Safe: guide coming with the next release."],
              ].map(([a, b]) => (
                <div key={a} style={{ padding: "16px 0", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 17 }}>{a}</span>
                  <span className="small">{b}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <CodeCard title="add to Claude Code (MCP), after building mcp/ from the repo" code={"claude mcp add fengce -- node /path/to/fengce/mcp/dist/server.mjs"} />
              <CodeCard title="what the agent gets back (preflight_transaction)" code={'{\n  "enforced": true,\n  "decision": "deny",\n  "reason": "FengceDenied(0x0bb9…0707, 0x779D…3736)"\n}'} />
            </div>
          </div>
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
              <table className="rt" style={{ minWidth: 560 }}>
                <thead>
                  <tr><th>Wallet</th><th>Enforced</th><th>Permanence (isBound)</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {[["Safe", "yes", "yes", "guard on owner and module paths"], ["Kernel, Nexus, Etherspot (7579)", "yes", "not yet", "the hook can be uninstalled on some"], ["Alchemy MA v2 (6900)", "yes", "not yet", "hook"], ["EOA, 7702, embedded", "no", "no", "move funds to a Safe"]].map(([a, b, cc, d]) => (
                    <tr key={a}>
                      <td>{a}</td>
                      <td className="mono" style={{ fontSize: 13, color: b === "yes" ? "var(--allow)" : "var(--muted)" }}>{b}</td>
                      <td className="mono" style={{ fontSize: 13, color: cc === "yes" ? "var(--allow)" : "var(--muted)" }}>{cc}</td>
                      <td className="muted">{d}</td>
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

      {tab === "judges" && (
        <div>
          {addrs.map(([a, b]) => (
            <div key={a} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.6fr)", gap: 16, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{a}</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--muted)", overflowWrap: "anywhere" }} title={b}>{b.length > 60 && b.startsWith("0x") ? short(b, 6) : b}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

mount("fengce", 1, <Fengce />);
