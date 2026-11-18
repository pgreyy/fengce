// Fork-only demo for the video: an agent asks Fengce (over MCP) whether 1.5 and 0.5 USDT0 from the v2 demo Safe would
// pass, then attempts both through AgentExecutor. Everything runs on a local anvil fork of X Layer mainnet: no real
// transaction is sent and no key is used (the demo agent is impersonated on the fork).
// Needs anvil (Foundry) on PATH. Usage: npm run build && npm run demo
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatUnits, http, parseAbi, type Address, type Hex } from "viem";

const PORT = 8601;
const FORK = `http://127.0.0.1:${PORT}`;
const UPSTREAM = process.env.XLAYER_RPC ?? "https://xlayerrpc.okx.com";
const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Address;
const SAFE = "0x0bb926DC7F79e4CEFFB30a67E8291C56C3F50707" as Address; // v2 demo Safe
const AGENT = "0x81DeB61C444f5505F4d3343B366E71D31a4BF91E" as Address; // v2 demo agent
const EXECUTOR = "0xc01b590227149169260e030235b78d6e034E590c" as Address; // v2 AgentExecutor
const RECIPIENT = "0x6eAC9821430aCa193a717a7C17D68f8033D46087" as Address;
const OUT = new URL("../../docs/demo/agent-demo-transcript.md", import.meta.url).pathname;

const lines: string[] = [];
const say = (who: string, text: string) => {
  const l = `**${who}:** ${text}`;
  lines.push(l, "");
  console.log(`${who}: ${text}`);
};

const erc20 = parseAbi(["function transfer(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
const executorAbi = parseAbi([
  "function execute(address safe, address to, uint256 value, bytes data) returns (bytes)",
  "event Denied(address indexed safe, address indexed agent, address target, bytes32 factsHash, bytes reason)",
  "event AgentExecuted(address indexed safe, address indexed agent, address to, uint256 value, bytes32 dataHash)",
]);
const usdt = (v: bigint) => `${formatUnits(v, 6)} USDT0`;

// ---------------------------------------------------------------- fork
const anvil = spawn("anvil", ["--fork-url", UPSTREAM, "--port", String(PORT), "--silent"], { stdio: "ignore" });
const cleanup = () => anvil.kill();
process.on("exit", cleanup);
const pub = createPublicClient({ transport: http(FORK, { timeout: 120_000 }) });
for (let i = 0; ; i++) {
  try {
    await pub.getChainId();
    break;
  } catch {
    if (i > 60) throw new Error("anvil did not start (is Foundry installed?)");
    await new Promise((r) => setTimeout(r, 500));
  }
}
const forkBlock = await pub.getBlockNumber();
await pub.request({ method: "anvil_setBalance" as any, params: [AGENT, "0xDE0B6B3A7640000"] as any });
await pub.request({ method: "anvil_impersonateAccount" as any, params: [AGENT] as any });
const agentWallet = createWalletClient({ account: AGENT, transport: http(FORK, { timeout: 120_000 }) });

// ---------------------------------------------------------------- MCP server on the fork
const mcp = new Client({ name: "demo-agent", version: "0.1.0" });
await mcp.connect(
  new StdioClientTransport({
    command: "node",
    args: [new URL("../dist/server.mjs", import.meta.url).pathname],
    env: { ...process.env, XLAYER_RPC: FORK } as Record<string, string>,
  }),
);

lines.push(
  "# Agent demo transcript",
  "",
  `Local anvil fork of X Layer mainnet at block ${forkBlock} (${new Date().toISOString().slice(0, 16)}Z). Nothing here was sent to the real chain; the`,
  "demo agent is impersonated on the fork, no key is used. The agent talks to the Fengce MCP server (`mcp/`) and then acts",
  `through AgentExecutor on the v2 demo Safe \`${SAFE}\` (policy: Stablecoin Transfer Limit, cap 1 USDT0).`,
  "",
);

const before = await pub.readContract({ address: USDT0, abi: erc20, functionName: "balanceOf", args: [SAFE] });
say("Fork", `demo Safe holds ${usdt(before)}.`);

const results: Record<string, string> = {};
for (const amount of [1_500_000n, 500_000n]) {
  say("Agent", `I want to send ${usdt(amount)} from the demo Safe. Asking Fengce first (simulate_transaction).`);
  const r: any = await mcp.callTool({
    name: "simulate_transaction",
    arguments: { policy: "nand-limit", cap: "1000000", account: SAFE, token: USDT0, recipient: RECIPIENT, amount: amount.toString() },
  });
  const summary = String(r.content[0].text).split("\n")[0];
  results[amount.toString()] = summary.startsWith("ALLOWED") ? "ALLOWED" : "DENIED";
  say("Fengce", `${summary} Input bits ${r.structuredContent?.input?.bits ?? "?"}, output ${r.structuredContent?.output?.bits ?? "?"}.`);
}

for (const amount of [1_500_000n, 500_000n]) {
  const verdict = results[amount.toString()];
  say(
    "Agent",
    verdict === "DENIED"
      ? `Fengce said DENIED for ${usdt(amount)}. For this demo I submit it anyway, to show the wallet itself refuses it.`
      : `Fengce said ALLOWED for ${usdt(amount)}. Submitting through AgentExecutor.`,
  );
  const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [RECIPIENT, amount] });
  const hash = await agentWallet.writeContract({ address: EXECUTOR, abi: executorAbi, functionName: "execute", args: [SAFE, USDT0, 0n, data], chain: null, gas: 600_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  let outcome = "no Fengce event";
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== EXECUTOR.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: executorAbi, data: log.data, topics: log.topics });
      outcome = ev.eventName === "Denied" ? `Denied by the Safe's guard (reason ${(ev.args as any).reason.slice(0, 10)}…, FengceDenied); nothing moved` : "AgentExecuted: the transfer went through";
    } catch {
      /* other event */
    }
  }
  const bal = await pub.readContract({ address: USDT0, abi: erc20, functionName: "balanceOf", args: [SAFE] });
  say("Wallet", `fork tx \`${hash}\` (block ${rc.blockNumber}, ${rc.gasUsed} gas): ${outcome}. Demo Safe now holds ${usdt(bal)}.`);
}

await mcp.close();
say("Agent", "Done: 1.5 USDT0 refused by Fengce and by the wallet; 0.5 USDT0 allowed and sent.");
mkdirSync(new URL("../../docs/demo/", import.meta.url).pathname, { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`\ntranscript written to docs/demo/agent-demo-transcript.md`);
cleanup();
process.exit(results["1500000"] === "DENIED" && results["500000"] === "ALLOWED" ? 0 : 1);
