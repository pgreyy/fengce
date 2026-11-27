import { Ruled, type Tone } from "../okun/Ruled";
import { Addr, mount } from "../okun/ui";
import { EXPLORER_TX } from "../okun/wallet";
import { DEPLOYMENT, EXPLORER } from "../lib/chain";

const AGENT_COLS = ["Prompt rules", "Wallet warnings", "Vendor policy", "Fengce"];
const AGENT: [string, ...[string, Tone][]][] = [
  ["Agent talked out of its rule (Freysa)", ["Bypassed", "b"], ["No human reads them", "b"], ["Blocked if set", "m"], ["Blocked: the circuit doesn't read prompts", "g"]],
  ["Agent dashboard hijacked (AIXBT)", ["Bypassed", "b"], ["Not involved", "m"], ["Blocked unless the policy admin is reached too", "m"], ["Blocked, and loosening waits 1 day in public", "g"]],
  ["Vendor servers down or hacked", ["n/a", "m"], ["n/a", "m"], ["Exposed", "b"], ["Not affected: no vendor in the loop", "g"]],
];

const c = DEPLOYMENT.contracts as Record<string, string>;

function Agents() {
  return (
    <main className="pg w" style={{ paddingTop: 64, paddingBottom: 110, display: "flex", flexDirection: "column", gap: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <span className="lbl">Agents</span>
        <h1 className="disp" style={{ fontSize: 50 }}>
          The agent signs. <em>The wallet decides.</em>
        </h1>
        <p className="body" style={{ color: "var(--text)" }}>Give an AI agent its own key on a Fengce-bound Safe. Every call it makes passes your limits on chain before anything moves.</p>
        <p className="body">If the agent is tricked into overspending, the chain says no and returns a reason code the agent can read and report back to you.</p>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <span className="lbl">How a call travels</span>
        <div className="plates">
          {[
            ["Agent key", "OKX Agentic Wallet, or any key the agent holds", "ASKS"],
            ["AgentExecutor", "addr:" + c.AgentExecutor, "CHECKS FIRST"],
            ["Your Safe", "holds the funds; the agent is a module, not an owner", "HOLDS FUNDS"],
            ["FengceGuard + pinned circuit", "addr:" + c.FengceGuard, "DECIDES"],
            ["X Layer", "allowed calls run; refused calls are recorded as Denied with a reason", "RECORDS"],
          ].map(([a, b, n], i) => (
            <div key={a} className={`plate${i === 3 ? " hl" : ""}`}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span>{a}</span>
                {b.startsWith("addr:") ? (
                  <Addr value={b.slice(5)} link={`${EXPLORER}/address/${b.slice(5)}`} label={`Copy ${a} address`} />
                ) : (
                  <span className="mono muted" style={{ fontSize: 12 }}>{b}</span>
                )}
              </span>
              <span className="lbl" style={i === 3 ? { color: "var(--accent)" } : undefined}>{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 40, alignItems: "start" }}>
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {[
            ["Agents check before they sign", "The Fengce SDK, MCP server and agent skill answer allowed or not, with the reason, before anything is sent."],
            ["An agent can't loosen its own limits", "Only the Safe's owners can schedule a change, and loosening waits 1 day like any other."],
            ["Refused calls leave a record", "AgentExecutor records a refused call as a Denied event with the reason, so you can see what the agent tried."],
            ["Per-agent caps", "A separate daily budget for each agent key, with its own reason code (guard v3)."],
          ].map(([a, b]) => (
            <div key={a} style={{ padding: "16px 0", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 17 }}>{a}</span>
              <span className="small">{b}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            ["The demo agent on mainnet: one call refused", "Denied · over the limit", "r", "0x9b70d386a2782e269ab1d3b1df6de767534a5b5b7904998abd92a651d2584a1b"],
            ["And one allowed", "AgentExecuted", "g", "0x7a70f5c9713fd9236ecdd81287bcf775253d2cbea19c857524bb1047acfcccab"],
          ].map(([title, ev, tone, tx]) => (
            <div key={tx} className="code">
              <div className="code-head">
                <span className="lbl">// {title}</span>
              </div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <span className={`tag ${tone}`} style={{ alignSelf: "flex-start" }}>{ev}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--codeText)" }}>
                  <span className="mono muted" style={{ fontSize: 12 }}>tx</span>
                  <Addr value={tx} link={EXPLORER_TX(tx)} label="Copy transaction ID" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="lbl">When an AI agent goes wrong</span>
        <Ruled cols={AGENT_COLS} rows={AGENT} label="AI agent failure scenarios compared" />
      </section>
    </main>
  );
}

mount("agents", 1, <Agents />);
