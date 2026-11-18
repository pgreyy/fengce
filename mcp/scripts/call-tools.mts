// Calls every tool of the built server once, over stdio, against live X Layer mainnet. Read-only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const DEMO_SAFE = "0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707";
const TREASURY_SAFE = "0x5c53CDaED1cd64fc25AcC071b0Ca7ef891bB5661";
const RECIPIENT = "0x000000000000000000000000000000000000bEEF";

const client = new Client({ name: "fengce-check", version: "0.1.0" });
await client.connect(new StdioClientTransport({ command: "node", args: [new URL("../dist/server.mjs", import.meta.url).pathname] }));
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const calls: [string, Record<string, unknown>][] = [
  ["list_policies", {}],
  ["get_policy", { key: "nand-limit" }],
  ["quote_policy", { key: "comparator16" }],
  ["simulate_transaction", { policy: "nand-limit", cap: "1000000", token: USDT0, recipient: RECIPIENT, amount: "1500000" }],
  ["preflight_transaction", { safe: DEMO_SAFE, token: USDT0, recipient: RECIPIENT, amount: "500000" }],
  ["build_install_payload", { safe: TREASURY_SAFE, policy: "nand-limit", cap: "1000000", tokens: [USDT0], spenders: [] }],
  ["simulate_transaction", { policy: "no-such-policy", to: RECIPIENT }], // an error that says what to fix
];
let failures = 0;
for (const [name, args] of calls) {
  const r: any = await client.callTool({ name, arguments: args });
  const first = String(r.content?.[0]?.text ?? "").split("\n")[0];
  const expectError = name === "simulate_transaction" && args.policy === "no-such-policy";
  if (Boolean(r.isError) !== expectError) failures++;
  console.log(`${r.isError ? "ERROR" : "ok   "} ${name}: ${first.slice(0, 220)}`);
}
await client.close();
process.exit(failures ? 1 : 0);
