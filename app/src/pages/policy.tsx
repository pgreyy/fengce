import type { Address } from "viem";
import { circuit } from "../lib/data";
import { quoteFor } from "../lib/quotes";
import { PRESETS } from "../lib/policies";
import { STATELESS, Simulator } from "../sim/Simulator";
import { useState } from "react";
import { Addr, ErrorLine, Figure, Loading, Pill, Section, fmtInt, mount, param, tierTone, useLoad } from "../ui/kit";

interface TreeNode {
  processor: string;
  circuitId: string;
  netlistHash: string;
  nIn: number;
  nOut: number;
  nState: number;
  gateCount: number;
  refs: TreeNode[];
}

function Tree({ node }: { node: TreeNode }) {
  return (
    <ul className="tree">
      <li>
        <span className="mono">#{node.circuitId}</span> <Addr a={node.processor} n={3} />{" "}
        <span className="muted mono">
          {node.nIn}→{node.nOut} · {fmtInt(node.gateCount)} gates{node.nState ? ` · ${node.nState} latch` : ""}
        </span>
        {node.refs.length > 0 && node.refs.map((r, i) => <Tree key={i} node={r} />)}
      </li>
    </ul>
  );
}

function PolicyPage() {
  // ?preset=<key> (links from the former Simulator page) or ?processor=&id=; ?tab=try opens "Try it".
  const byKey = PRESETS.find((p) => p.key === param("preset"));
  const first = byKey ?? PRESETS[0];
  const processor = ((byKey ? null : param("processor")) ?? first.processor) as Address;
  const id = BigInt((byKey ? null : param("id")) ?? first.id.toString());
  const [tab, setTab] = useState<"details" | "try">(param("tab") === "try" ? "try" : "details");
  const pick = (t: "details" | "try") => {
    setTab(t);
    try {
      const u = new URL(location.href);
      if (t === "try") u.searchParams.set("tab", "try");
      else u.searchParams.delete("tab");
      history.replaceState(null, "", u);
    } catch {
      /* ignore */
    }
  };
  const tryable = STATELESS.find((p) => p.processor.toLowerCase() === processor.toLowerCase() && p.id === id);
  const { data, error, loading } = useLoad(async () => (await circuit(processor, id)) as any, [processor, id.toString()]);
  const q = quoteFor(processor, id);
  return (
    <>
      <h1 className="title">{data?.name ?? `Circuit #${id}`}</h1>
      <p className="lede">{data?.description ?? (loading ? " " : "A TapeOut circuit on X Layer (no description known to this app).")}</p>
      <div className="seg" role="tablist" aria-label="Policy view" style={{ margin: "18px 0 0" }}>
        <button type="button" role="tab" aria-pressed={tab === "details"} aria-selected={tab === "details"} onClick={() => pick("details")}>
          Details
        </button>
        <button type="button" role="tab" aria-pressed={tab === "try"} aria-selected={tab === "try"} onClick={() => pick("try")}>
          Try it
        </button>
      </div>
      {tab === "try" && (
        <Section n={1} label="Try it">
          {tryable ? (
            <>
              <p className="lede" style={{ marginTop: 0 }}>
                A proposed transaction, run through this policy gate by gate. Facts and input bits come from one eth_call on X Layer; the gates are
                evaluated in your browser from the circuit's on-chain netlist.
              </p>
              <Simulator presetKey={tryable.key} />
            </>
          ) : (
            <p className="note">Try it runs the stateless Catalog policies. This circuit is stateful or not a Catalog preset, so it cannot be tried here.</p>
          )}
        </Section>
      )}
      {tab === "details" && loading && <Loading what="the circuit" />}
      <ErrorLine error={error} />
      {tab === "details" && data && (
        <>
          <div className="figures" style={{ margin: "26px 0 8px" }}>
            <Figure v={fmtInt(data.gateCount)} k="Gates (with REF)" />
            <Figure v={`${data.nIn}→${data.nOut}`} k="Inputs → outputs" />
            <Figure v={data.evalGas ? fmtInt(data.evalGas) : "–"} k="Eval gas, zero input" />
            <Figure v={q?.fullPath ? fmtInt(q.fullPath) : "–"} k="Full Safe path gas (Quote)" />
          </div>
          <Section n={2} label="Policy" aside={tryable ? <a href="#" onClick={(e) => { e.preventDefault(); pick("try"); }}>Try it →</a> : undefined}>
            <div className="grid">
              <div className="c7">
                <h3>Allow and deny vectors</h3>
                <div className="tablewrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Input bits</th>
                        {data.nState > 0 && <th>State</th>}
                        <th>Output</th>
                        <th>On-chain</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.vectors.map((v: any, i: number) => (
                        <tr key={i}>
                          <td className="mono">{v.inputBits}</td>
                          {data.nState > 0 && <td className="mono">{v.state}</td>}
                          <td className="mono">{v.outputBits ?? "–"}</td>
                          <td>
                            <Pill tone={v.decision === "allow" ? "allow" : "deny"}>{v.decision}</Pill>
                            {v.expected && v.expected !== v.decision ? <span className="red mono"> expected {v.expected}</span> : null}
                          </td>
                          <td>{v.reason || <span className="muted">–</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Bits are written input 0 first. Each row was evaluated just now by the processor contract (eval or step) at block{" "}
                  <span className="mono">{fmtInt(data.block)}</span>.
                </p>
                {data.construction && (
                  <>
                    <h3 style={{ marginTop: 24 }}>Construction</h3>
                    <p>{data.construction}</p>
                  </>
                )}
              </div>
              <div className="c5">
                <h3>Circuit</h3>
                <dl className="kv">
                  <dt>Processor</dt>
                  <dd>
                    <Addr a={data.processor} />
                  </dd>
                  <dt>Circuit</dt>
                  <dd className="mono">#{data.id}</dd>
                  <dt>Tier</dt>
                  <dd>
                    <Pill tone={tierTone(q?.tier ?? data.tier)}>{q?.tier ?? data.tier ?? "–"}</Pill>
                  </dd>
                  <dt>Netlist hash</dt>
                  <dd className="mono">{data.netlistHash}</dd>
                  <dt>REF closure</dt>
                  <dd className="mono">{data.refClosureHash}</dd>
                  <dt>Processors</dt>
                  <dd className="mono">{data.processors.length}</dd>
                  {q && (
                    <>
                      <dt>Certificate</dt>
                      <dd className="mono">{q.certificateHash}</dd>
                    </>
                  )}
                </dl>
                <h3 style={{ marginTop: 24 }}>Dependency tree</h3>
                <Tree node={data.tree} />
              </div>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

mount("catalog", 1, <PolicyPage />);
