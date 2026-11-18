import { useEffect, useState } from "react";
import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { evaluateTrace, type CircuitTrace } from "@fengce/sdk";
import { ADDR, DEPLOYMENT, client } from "../lib/chain";
import { simulate } from "../lib/data";
import { PRESETS } from "../lib/policies";
import { GateGraph, useLevelClock } from "../sim/GateGraph";
import { Addr, ErrorLine, Section, fmtInt, mount, param } from "../ui/kit";

const STATELESS = PRESETS.filter((p) => !p.stateful);
const erc20 = parseAbi(["function transfer(address,uint256)"]);

type Kind = "erc20" | "native" | "raw";

function Bits({ bits, schema }: { bits: string; schema: any }) {
  return (
    <div className="bits">
      {schema.fields.map((f: any) => {
        const b = bits.slice(f.offset, f.offset + f.width);
        return (
          <div className="bitgroup" key={f.name}>
            <div className="k">
              {f.name} <span className="muted">[{f.offset}{f.width > 1 ? `..${f.offset + f.width - 1}` : ""}]</span>
            </div>
            <div className="b">
              {[...b].map((c, i) => (
                <span key={i} className={c === "1" ? "one" : "zero"}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reasonFor(sim: any, allowed: boolean): string {
  if (sim.stage !== "evaluated") return `Fails closed: ${sim.stage}${sim.error ? ` (${sim.error})` : ""}.`;
  const preset = STATELESS.find((p) => p.key === sim.policy.key);
  const v = preset?.vectors.find((x) => x.input.toLowerCase() === sim.input.hex.toLowerCase());
  if (v) return v.reason;
  return allowed ? "The circuit's output bit 0 is 1." : "The circuit's output bit 0 is 0.";
}

function SimulatorPage() {
  const [preset, setPreset] = useState(param("preset") && STATELESS.some((p) => p.key === param("preset")) ? param("preset")! : STATELESS[0].key);
  const [kind, setKind] = useState<Kind>("erc20");
  const [cap, setCap] = useState("1000000");
  const [token, setToken] = useState<string>(ADDR.usdt0);
  const [to, setTo] = useState("0x000000000000000000000000000000000000bEEF");
  const defaultAmount = (k: string) => (k === "comparator16" ? "400" : "1500000");
  const [amount, setAmount] = useState(defaultAmount(preset));
  const [data, setData] = useState("0x");
  const [account, setAccount] = useState<string>(DEPLOYMENT.demoSafe);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState<any>(null);
  const [trace, setTrace] = useState<CircuitTrace | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);
  const [run, setRun] = useState(0);
  const [finished, setFinished] = useState(false);
  const cur = useLevelClock(trace?.depth ?? 0, run, () => setFinished(true));

  async function go() {
    setBusy(true);
    setErr(null);
    setFinished(false);
    try {
      if (!isAddress(to) || !isAddress(account) || (kind === "erc20" && !isAddress(token))) throw new Error("An address field is not an address.");
      const tx =
        kind === "erc20"
          ? { to: token as Address, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [to as Address, BigInt(amount)] }) }
          : kind === "native"
            ? { to: to as Address, value: amount, data: "0x" as Hex }
            : { to: to as Address, value: amount, data: data as Hex };
      const s: any = await simulate({ preset, cap, account: account as Address, ...tx });
      setSim(s);
      if (s.input) {
        const p = STATELESS.find((x) => x.key === preset)!;
        const t = await evaluateTrace(client as never, p.processor, p.id, s.input.hex);
        setTrace(t.trace);
        setMatch(s.output ? t.output.toLowerCase() === s.output.hex.toLowerCase() : null);
      } else {
        setTrace(null);
        setMatch(null);
        setFinished(true);
      }
      setRun((x) => x + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ?run=1 runs the example transaction on load (shareable links).
  useEffect(() => {
    if (param("run") === "1") go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allowed = sim?.decision === "allow";
  const p = STATELESS.find((x) => x.key === preset)!;
  return (
    <>
      <h1 className="title">Simulator</h1>
      <p className="lede">A proposed transaction, run through a policy gate by gate. Facts and input bits come from one eth_call on X Layer; the gates are evaluated in your browser from the circuit's on-chain netlist.</p>
      <Section n={3} label="Simulator" aside={<a href={`../policy/?processor=${p.processor}&id=${p.id}`}>{p.name} →</a>}>
        <div className="grid">
          <div className="c4">
            <h3>Transaction</h3>
            <label className="field">
              <span>Policy</span>
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setAmount(defaultAmount(e.target.value));
                }}
              >
                {STATELESS.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cap (base units, for AmountGt bindings)</span>
              <input className="mono" value={cap} onChange={(e) => setCap(e.target.value)} />
            </label>
            <div className="field">
              <span>Call</span>
              <div className="seg">
                {(["erc20", "native", "raw"] as Kind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {k === "erc20" ? "ERC-20 transfer" : k === "native" ? "OKB transfer" : "Raw call"}
                  </button>
                ))}
              </div>
            </div>
            {kind === "erc20" && (
              <label className="field">
                <span>Token</span>
                <input className="mono" value={token} onChange={(e) => setToken(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>{kind === "erc20" ? "Recipient" : "To"}</span>
              <input className="mono" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="field">
              <span>{kind === "erc20" ? "Amount (base units)" : "Value (wei)"}</span>
              <input className="mono" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            {kind === "raw" && (
              <label className="field">
                <span>Data</span>
                <textarea className="mono" rows={3} value={data} onChange={(e) => setData(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>Account (the Safe)</span>
              <input className="mono" value={account} onChange={(e) => setAccount(e.target.value)} />
            </label>
            <button className="btn" type="button" disabled={busy} onClick={go} style={{ width: "100%" }}>
              {busy ? "Reading X Layer…" : "Run"}
            </button>
            <ErrorLine error={err} />

            {sim && (
              <>
                <h3 style={{ marginTop: 28 }}>Facts</h3>
                {sim.facts ? (
                  <dl className="kv mono">
                    <dt>Kind</dt>
                    <dd>{sim.facts.kind}</dd>
                    <dt>To</dt>
                    <dd>
                      <Addr a={sim.facts.to} />
                    </dd>
                    <dt>Token</dt>
                    <dd>
                      <Addr a={sim.facts.token} />
                    </dd>
                    <dt>Amount</dt>
                    <dd>{fmtInt(sim.facts.amount)}</dd>
                    <dt>Value</dt>
                    <dd>{fmtInt(sim.facts.value)}</dd>
                    <dt>Selector</dt>
                    <dd>{sim.facts.selector}</dd>
                  </dl>
                ) : (
                  <p className="muted">No facts: {sim.stage}.</p>
                )}
                {sim.input && (
                  <>
                    <h3 style={{ marginTop: 24 }}>Input bits</h3>
                    <Bits bits={sim.input.bits} schema={sim.policy.schema} />
                    <p className="mono muted" style={{ marginTop: 10 }}>
                      {sim.input.hex} · bit 0 first
                    </p>
                    <p className="mono muted" style={{ fontSize: 12 }}>
                      bindings: {(sim.policy.schema.bindings ?? []).map((b: any) => `${b.field} ← ${b.source}${b.param !== undefined ? `(${b.param})` : ""}`).join(" · ")}
                    </p>
                  </>
                )}
              </>
            )}
          </div>
          <div className="c8">
            {trace ? (
              <GateGraph trace={trace} cur={cur} fields={sim?.input?.bits ? expandFields(sim.policy.schema) : undefined} />
            ) : (
              <div className="stage" style={{ minHeight: 260, display: "grid", placeItems: "center" }}>
                <span className="muted mono">{sim ? "Nothing to evaluate." : "Run a transaction to see the circuit evaluate."}</span>
              </div>
            )}
            {sim && finished && (
              <>
                <div className={`verdict ${allowed ? "allow" : "deny"}`}>{allowed ? "ALLOWED" : "DENIED"}</div>
                <p style={{ fontSize: 16, margin: "0 0 6px" }}>{reasonFor(sim, allowed)}</p>
                {match !== null && (
                  <p className="mono muted">
                    Browser trace output {match ? "equals" : "DIFFERS FROM"} the on-chain evaluation ({sim.output?.hex}).
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

/** One label per input bit: the field name, with the bit index for multi-bit fields. */
function expandFields(schema: any): string[] {
  const out: string[] = [];
  for (const f of schema.fields) for (let i = 0; i < f.width; i++) out[f.offset + i] = f.width > 1 ? `${f.name}${i}` : f.name;
  return out;
}

mount("simulator", 1, <SimulatorPage />);
