// Limits → Build your own: one or two conditions combined into a rule, compiled into a TapeOut netlist, checked on every
// input in the browser, taped out from your wallet on processor #180, pinned, then used as the Safe's policy.
import { useMemo, useState } from "react";
import { encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { PinRegistryArtifact, evaluateLocally, parseNetlist, parseSchema, schemaHash, type SchemaFile } from "@fengce/sdk";
import { ADDR, client } from "../lib/chain";
import { TOKENS } from "./engine";
import { parseAmount } from "./LimitsEditor";
import { usePolicy } from "./policyChange";
import { Addr, StartLink, short } from "./ui";
import { EXPLORER_TX, sendFromWallet, useWallet } from "./wallet";

/** Processor #180 on X Layer, the open processor the Tilt-shield and counter circuits run on. */
const CPU = "0x7335a50819d44402e3D5E00239bBB80A13E7308F" as Address;
const cpuAbi = parseAbi([
  "function tapeout(bytes netlist, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function transistorsContract() view returns (address)",
  "function netlist(uint256 id) view returns (bytes)",
]);
const trAbi = parseAbi(["function mint(uint256 id, uint256 amount) payable", "function protocolFee() view returns (uint256)", "function NAND() view returns (uint256)"]);

type CondKind = "amount" | "token" | "to" | "foreign";
interface Cond {
  kind: CondKind;
  amount: string;
  token: keyof typeof TOKENS;
  to: string;
}
const LABEL: Record<CondKind, string> = { amount: "Amount over", token: "Paying with", to: "Sending to", foreign: "Proceeds go elsewhere" };

function binding(c: Cond): { source: string; param?: string } | null {
  if (c.kind === "amount") {
    const n = parseAmount(c.amount);
    return n === null ? null : { source: "AmountGt", param: String(Math.round(n * 1e6)) };
  }
  if (c.kind === "token") return { source: "TokenIs", param: BigInt(TOKENS[c.token].address).toString() };
  if (c.kind === "to") return isAddress(c.to) ? { source: "ToIs", param: BigInt(getAddress(c.to)).toString() } : null;
  return { source: "RecipientIsForeign" };
}

/** Netlist: inputs a (bit 0), b (bit 1). AND: refuse when both, allow = NAND(a, b). OR: refuse when either,
 * allow = NOR(a, b) = NAND(a OR b, a OR b). One condition uses AND with b fixed to 1. */
function compile(op: "and" | "or"): Hex {
  const u24 = (v: number) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const recs: [number, number][] = [];
  let next = 4; // signals 0, 1 constants; 2, 3 inputs a, b
  const nand = (a: number, b: number) => (recs.push([a, b]), next++);
  if (op === "and") nand(2, 3);
  else {
    const t = nand(nand(2, 2), nand(3, 3)); // a OR b
    nand(t, t);
  }
  return toHex(new Uint8Array(recs.flatMap(([a, b]) => [0, ...u24(a), ...u24(b)])));
}

export function BuildPanel() {
  const w = useWallet();
  const [a, setA] = useState<Cond>({ kind: "amount", amount: "2", token: "USDT0", to: "" });
  const [b, setB] = useState<Cond | null>({ kind: "token", amount: "2", token: "USDT0", to: "" });
  const [op, setOp] = useState<"and" | "or">("and");
  const [checked, setChecked] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [out, setOut] = useState<{ id?: bigint; pin?: Hex; txs: Hex[] }>({ txs: [] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const netlist = compile(b ? op : "and");
  const ba = binding(a);
  const bb = b ? binding(b) : null;
  const schema: SchemaFile | null = useMemo(() => {
    if (!ba || (b && !bb)) return null;
    return parseSchema({
      format: "fengce-schema/1",
      netlistHash: keccak256(netlist),
      nIn: 2,
      fields: [{ name: "a", kind: "bool", offset: 0, width: 1 }, b ? { name: "b", kind: "bool", offset: 1, width: 1 } : { name: "one", kind: "flag", offset: 1, width: 1, value: 1 }],
      bindings: [{ field: "a", ...ba }, ...(b && bb ? [{ field: "b", ...bb }] : [])],
    });
  }, [netlist, ba?.source, ba?.param, bb?.source, bb?.param, !!b]);
  const gates = (netlist.length - 2) / 2 / 7;

  async function checkAll() {
    const cache = new Map([[`${CPU}:0`, { cpu: CPU, id: 0n, nIn: 2, nOut: 1, nState: 0, records: parseNetlist(netlist) }]]);
    const rows: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await evaluateLocally({} as never, CPU as never, 0n, toHex(new Uint8Array([i])), "0x", cache as never);
      const allow = (parseInt(r.output.slice(2), 16) & 1) === 1;
      const A = i & 1, B = (i >> 1) & 1;
      const want = b ? (op === "and" ? !(A && B) : !(A || B)) : !(A && B);
      if (!b && B === 0) continue; // b is fixed to 1 with one condition
      if (allow !== want) throw new Error(`mismatch at a=${A} b=${B}`);
      rows.push(`${A}${b ? B : ""}→${allow ? "allow" : "refuse"}`);
    }
    setChecked(`Checked on every input: ${rows.join(" · ")}`);
  }

  async function tapeout() {
    setMsg(null);
    try {
      if (!w.account) throw new Error("Connect your wallet.");
      setStep("mint");
      const tr = (await client.readContract({ address: CPU, abi: cpuAbi, functionName: "transistorsContract" })) as Address;
      const [fee, nandId, tapeFee] = await Promise.all([
        client.readContract({ address: tr, abi: trAbi, functionName: "protocolFee" }),
        client.readContract({ address: tr, abi: trAbi, functionName: "NAND" }),
        client.readContract({ address: CPU, abi: cpuAbi, functionName: "TAPEOUT_FEE" }),
      ]);
      const txs: Hex[] = [];
      const m = await sendFromWallet(tr, encodeCall(trAbi, "mint", [nandId, BigInt(gates)]), undefined, fee as bigint);
      if (m.status !== "success") throw new Error("Minting the transistors reverted.");
      txs.push(m.hash);
      setStep("tapeout");
      const { result: id } = await client.simulateContract({ account: w.account, address: CPU, abi: cpuAbi, functionName: "tapeout", args: [netlist, 2, 1], value: tapeFee as bigint });
      const t = await sendFromWallet(CPU, encodeCall(cpuAbi, "tapeout", [netlist, 2, 1]), undefined, tapeFee as bigint);
      if (t.status !== "success") throw new Error("The tape-out reverted.");
      txs.push(t.hash);
      const onChain = (await client.readContract({ address: CPU, abi: cpuAbi, functionName: "netlist", args: [id as bigint] })) as Hex;
      if (onChain.toLowerCase() !== netlist.toLowerCase()) throw new Error("The taped-out netlist does not match.");
      setStep("pin");
      const regAbi = PinRegistryArtifact.abi as never;
      const sh = schemaHash(schema!);
      const zero = `0x${"0".repeat(64)}` as Hex;
      const { result: pin } = await client.simulateContract({ account: w.account, address: ADDR.pinRegistry, abi: regAbi, functionName: "pin", args: [CPU, id, sh, zero] });
      const p = await sendFromWallet(ADDR.pinRegistry, encodeCall(regAbi, "pin", [CPU, id, sh, zero]));
      if (p.status !== "success") throw new Error("Pinning reverted.");
      txs.push(p.hash);
      setOut({ id: id as bigint, pin: pin as Hex, txs });
      setMsg({ ok: true, text: `Taped out as circuit #${String(id)} on processor #180 and pinned.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setStep(null);
    }
  }

  async function install() {
    setMsg(null);
    try {
      if (!w.account || !w.safe || !out.pin || !schema) throw new Error("Tape out and pin first, with a Safe chosen.");
      setStep("policy");
      const r = await usePolicy(w.account, w.safe, out.pin, schema);
      setOut((o) => ({ ...o, txs: [...o.txs, r.hash] }));
      setMsg({ ok: true, text: r.scheduled ? "Change scheduled: it can apply after the 1-day wait." : "Installed: your Safe now runs your circuit." });
    } catch (e) {
      setMsg({ ok: false, text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally {
      setStep(null);
    }
  }

  const condEditor = (c: Cond, set: (c: Cond) => void) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select className="field" style={{ width: 200 }} value={c.kind} onChange={(e) => set({ ...c, kind: e.target.value as CondKind })}>
        {(Object.keys(LABEL) as CondKind[]).map((k) => (
          <option key={k} value={k}>{LABEL[k]}</option>
        ))}
      </select>
      {c.kind === "amount" && <input className="field num" style={{ width: 120 }} inputMode="decimal" value={c.amount} onChange={(e) => set({ ...c, amount: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="Amount (USDT0)" />}
      {c.kind === "amount" && <span className="mono muted" style={{ fontSize: 13 }}>USDT0 units</span>}
      {c.kind === "token" && (
        <select className="field" style={{ width: 140 }} value={c.token} onChange={(e) => set({ ...c, token: e.target.value as keyof typeof TOKENS })}>
          {Object.keys(TOKENS).map((t) => (
            <option key={t} value={t}>{TOKENS[t as keyof typeof TOKENS].symbol}</option>
          ))}
        </select>
      )}
      {c.kind === "to" && <input className="field mono" style={{ width: 300 }} value={c.to} onChange={(e) => set({ ...c, to: e.target.value.trim() })} placeholder="0x…" aria-label="Address" />}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p className="body" style={{ maxWidth: 760 }}>
        Combine one or two conditions into a rule. It is compiled into a TapeOut netlist, checked here on every input, then taped out from your wallet on processor #180 (one
        transistor mint and the tape-out fee, paid in OKB), pinned, and used as your Safe's policy.
      </p>
      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="lbl">Refuse a transaction when</span>
        {condEditor(a, (c) => (setA(c), setChecked(null)))}
        {b ? (
          <>
            <div className="seg" role="group" aria-label="Combine" style={{ alignSelf: "flex-start" }}>
              <button type="button" aria-pressed={op === "and"} onClick={() => (setOp("and"), setChecked(null))}>and</button>
              <button type="button" aria-pressed={op === "or"} onClick={() => (setOp("or"), setChecked(null))}>or</button>
            </div>
            {condEditor(b, (c) => (setB(c), setChecked(null)))}
            <button type="button" className="alink" style={{ alignSelf: "flex-start" }} onClick={() => (setB(null), setChecked(null))}>Remove the second condition</button>
          </>
        ) : (
          <button type="button" className="alink" style={{ alignSelf: "flex-start" }} onClick={() => setB({ kind: "token", amount: "2", token: "USDT0", to: "" })}>Add a second condition</button>
        )}
        <div className="small" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>{gates} NAND gate{gates === 1 ? "" : "s"}</span>
          <span>netlist <Addr value={netlist} n={8} label="Copy netlist" /></span>
          {schema && <span>schema hash <Addr value={schemaHash(schema)} n={6} label="Copy schema hash" /></span>}
        </div>
        <button type="button" className="pill line" style={{ alignSelf: "flex-start" }} disabled={!schema} onClick={() => checkAll().catch((e) => setChecked((e as Error).message))}>Check every input</button>
        {checked && <span className="mono small">{checked}</span>}
      </div>
      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="lbl">Tape out, pin, install</span>
        {!w.account ? (
          <StartLink className="pill accent big">Connect to tape out</StartLink>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="pill accent big" disabled={!checked || !schema || !!step || !!out.pin} onClick={tapeout}>
              {step === "mint" ? "Minting transistors" : step === "tapeout" ? "Taping out" : step === "pin" ? "Pinning" : out.pin ? "Taped out" : "Tape out and pin"}
            </button>
            <button type="button" className="pill line big" disabled={!out.pin || !w.safe || !!step} onClick={install}>
              {step === "policy" ? "Confirm in your wallet" : "Use as my Safe's policy"}
            </button>
          </div>
        )}
        {out.pin && (
          <span className="small">
            Circuit #{String(out.id)} on processor #180 · pin <Addr value={out.pin} n={6} label="Copy pin" />
          </span>
        )}
        {out.txs.length > 0 && (
          <span className="small" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {out.txs.map((h) => (
              <a key={h} className="alink" href={EXPLORER_TX(h)} target="_blank" rel="noreferrer noopener">tx {short(h)}</a>
            ))}
          </span>
        )}
        {msg && <span className={msg.ok ? "mono" : "err"} style={{ fontSize: 14, color: msg.ok ? "var(--allow)" : undefined }}>{msg.text}</span>}
        <span className="small">Designers can list a pinned circuit in the Fengce Catalog with its test vectors and, optionally, an install fee: 80% of each fee goes to the designer (listings are free during launch).</span>
      </div>
    </div>
  );
}

function encodeCall(abi: readonly unknown[], functionName: string, args: readonly unknown[]): Hex {
  return (encodeFunctionData as (x: unknown) => Hex)({ abi, functionName, args });
}
