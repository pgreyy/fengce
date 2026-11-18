import { getAddress } from "viem";
import { circuit } from "@/lib/data";

export const dynamic = "force-dynamic";

function Tree({ n }: { n: any }) {
  return (
    <li>
      <span className="mono">{n.processor} #{n.circuitId}</span> <span className="muted">{n.gateCount} gates, {n.nIn} in, {n.nOut} out, {n.nState} state</span>
      {n.refs.length > 0 && (
        <ul className="tree">
          {n.refs.map((r: any, i: number) => (
            <Tree key={i} n={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function PolicyPage({ params }: { params: Promise<{ processor: string; id: string }> }) {
  const { processor, id } = await params;
  const c = (await circuit(getAddress(processor), BigInt(id))) as any;
  return (
    <>
      <h1>{c.name ?? `Policy ${c.processor} #${c.id}`}</h1>
      <p>{c.description ?? <span className="muted">No description on file for this circuit.</span>}</p>
      <table>
        <tbody>
          <tr><th>Inputs / outputs / state bits</th><td>{c.nIn} / {c.nOut} / {c.nState}</td></tr>
          <tr><th>Gates (including references)</th><td>{c.gateCount}</td></tr>
          <tr><th>Netlist hash</th><td className="mono">{c.netlistHash}</td></tr>
          <tr><th>Dependency closure hash</th><td className="mono">{c.refClosureHash}</td></tr>
          <tr><th>Processors in closure</th><td className="mono">{c.processors.join(", ")}</td></tr>
          <tr><th>Processor / circuit</th><td className="mono">{c.processor} #{c.id}</td></tr>
          <tr><th>Eval gas</th><td>{c.evalGas ?? "n/a"}</td></tr>
          <tr><th>Tier (eval gas)</th><td>{c.tier ?? "n/a"} <span className="muted">{c.tierNote} The full Safe path tier is in the Quote certificate.</span></td></tr>
          <tr><th>Block</th><td>{c.block}</td></tr>
        </tbody>
      </table>
      {c.construction && (
        <>
          <h2>Circuit construction</h2>
          <p>{c.construction}</p>
        </>
      )}
      <h2>Allow and deny vectors (evaluated live)</h2>
      {c.vectors.length === 0 ? (
        <p className="muted">No vectors on file, and too many inputs to list every case.</p>
      ) : (
        <table>
          <thead><tr><th>Input (hex)</th><th>Input bits (bit 0 first)</th>{c.nState > 0 && <th>State before</th>}<th>Output</th><th>Decision</th><th>Reason</th></tr></thead>
          <tbody>
            {c.vectors.map((v: any, i: number) => (
              <tr key={i}>
                <td className="mono">{v.input}</td><td className="mono">{v.inputBits}</td>{c.nState > 0 && <td className="mono">{v.state}</td>}
                <td className="mono">{v.output ?? "reverted"}</td>
                <td className={v.decision === "allow" ? "allow" : "deny"}>{v.decision}{v.expected && v.expected !== v.decision ? ` (expected ${v.expected})` : ""}</td>
                <td>{v.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Dependency tree</h2>
      <ul className="tree"><Tree n={c.tree} /></ul>
    </>
  );
}
