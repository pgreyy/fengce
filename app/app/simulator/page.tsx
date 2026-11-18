"use client";
import { useState } from "react";
import { encodeFunctionData, parseAbi } from "viem";

const erc20 = parseAbi(["function transfer(address,uint256)", "function approve(address,uint256)"]);
const router = parseAbi(["function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"]);
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const WOKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b";
const ROUTER = "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA";
const ACCOUNT = "0x000000000000000000000000000000000000fe11";
const OTHER = "0x000000000000000000000000000000000000dEaD";

const SAMPLES: Record<string, { label: string; to: string; value: string; data: string }> = {
  native50: { label: "Send 50 wei native", to: OTHER, value: "50", data: "0x" },
  native150: { label: "Send 150 wei native", to: OTHER, value: "150", data: "0x" },
  usdt0_80: { label: "USDT0 transfer 80", to: USDT0, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [OTHER, 80n] }) },
  approve500: { label: "USDT0 approve router 500", to: USDT0, value: "0", data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [ROUTER, 500n] }) },
  unknown: { label: "Unknown call", to: OTHER, value: "0", data: "0xdeadbeef" },
};

export default function Simulator() {
  const [preset, setPreset] = useState("nand-limit");
  const [cap, setCap] = useState("100");
  const [sample, setSample] = useState("native150");
  const [tx, setTx] = useState(SAMPLES.native150);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const r = await fetch("/api/simulate", { method: "POST", body: JSON.stringify({ preset, cap, account: ACCOUNT, ...tx }) });
    setRes(await r.json());
    setBusy(false);
  }

  return (
    <>
      <h1>Simulator</h1>
      <p className="muted">
        Runs a proposed transaction through a policy with one eth_call on X Layer (nothing is sent): facts from the call, circuit input bits from the
        schema, the circuit's output, and the decision. Swap facts need a registered decoder, which this page does not simulate yet.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label>Policy</label>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="nand-limit">Stablecoin Transfer Limit</option>
          <option value="nor-swap">Protected Swap Policy</option>
        </select>
        <label>Cap</label>
        <input value={cap} onChange={(e) => setCap(e.target.value)} />
        <label>Sample</label>
        <select value={sample} onChange={(e) => { setSample(e.target.value); setTx(SAMPLES[e.target.value]); }}>
          {Object.entries(SAMPLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label>To</label>
        <input className="mono" value={tx.to} onChange={(e) => setTx({ ...tx, to: e.target.value })} />
        <label>Value (wei)</label>
        <input value={tx.value} onChange={(e) => setTx({ ...tx, value: e.target.value })} />
        <label>Data</label>
        <textarea rows={3} value={tx.data} onChange={(e) => setTx({ ...tx, data: e.target.value })} />
        <span />
        <button disabled={busy}>{busy ? "Simulating" : "Simulate"}</button>
      </form>
      {res && (res.error && !res.stage ? <p className="deny">{res.error}</p> : (
        <>
          <h2>Decision</h2>
          <table><tbody>
            <tr><th>Decision</th><td className={res.decision === "allow" ? "allow" : "deny"}>{res.decision}</td></tr>
            <tr><th>Stage</th><td>{res.stage}</td></tr>
            {res.error && <tr><th>Reason</th><td className="mono">{res.error}</td></tr>}
            <tr><th>Schema hash</th><td className="mono">{res.policy.schemaHash}</td></tr>
          </tbody></table>
          {res.facts && (<>
            <h2>Facts</h2>
            <table><tbody>
              {Object.entries(res.facts).filter(([k]) => isNaN(Number(k))).map(([k, v]) => (
                <tr key={k}><th>{k}</th><td className="mono">{String(v)}</td></tr>
              ))}
            </tbody></table>
          </>)}
          {res.input && (<>
            <h2>Circuit input</h2>
            <table>
              <thead><tr><th>Hex</th><th>Bits (bit 0 first)</th><th>Fields</th><th>Output</th></tr></thead>
              <tbody><tr>
                <td className="mono">{res.input.hex}</td><td className="mono">{res.input.bits}</td><td>{res.input.fields.join(", ")}</td>
                <td className="mono">{res.output ? `${res.output.hex} (bit 0 = ${res.output.bits[0]})` : "-"}</td>
              </tr></tbody>
            </table>
          </>)}
        </>
      ))}
    </>
  );
}
