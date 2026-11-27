// One local run of each agent tool (check, explain_refusal, pay_through_safe) over stdio against the Milestone 2 demo
// Safe on X Layer mainnet. check and explain_refusal are read-only; pay_through_safe sends one 0.05 USDT0 payment from
// the demo Safe to its owner with the OKX Agentic Wallet agent (signer onchainos) only when called with --send.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import m2 from "../../deployments/m2-demo-xlayer-196.json" with { type: "json" };

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const SAFE = m2.safe, OWNER = m2.owner, AGENT = m2.agent;
const c = new Client({ name: "fengce-agent-run", version: "0.2.0" });
await c.connect(new StdioClientTransport({ command: "node", args: [new URL("../dist/server.mjs", import.meta.url).pathname] }));
const show = async (name: string, args: Record<string, unknown>) => {
  const r: any = await c.callTool({ name, arguments: args });
  console.log(`\n== ${name} ${JSON.stringify(args).slice(0, 160)}\n${r.isError ? "ERROR " : ""}${String(r.content?.[0]?.text ?? "").split("\n\n")[0]}`);
  return r;
};
await show("check", { safe: SAFE, token: USDT0, recipient: OWNER, amount: "50000" });
await show("check", { safe: SAFE, agent: AGENT, token: USDT0, recipient: OWNER, amount: "600000" });
await show("explain_refusal", { safe: SAFE, token: USDT0, recipient: OWNER, amount: "3000000" });
await show("pay_through_safe", { safe: SAFE, agent: AGENT, token: USDT0, recipient: OWNER, amount: "50000", signer: process.argv.includes("--send") ? "onchainos" : "none" });
await c.close();
