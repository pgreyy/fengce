// Shared by "Add a circuit" and "Build your own": use a pinned circuit (with its schema and bindings) as the Safe's
// FengceGuard policy. A Safe without Fengce installs it in one owner transaction; a Safe that has it schedules the change,
// which can apply after the 1-day wait (a different circuit is never a tightening).
import { encodeFunctionData, type Address, type Hex } from "viem";
import { FengceGuardArtifact, configInput, type SchemaFile } from "@fengce/sdk";
import { ENGINE, ROUTER_SELECTORS, multiSend } from "./engine";
import { readInstalled } from "./reads";
import { sendFromWallet, simulateSafeTx } from "./wallet";

const guardAbi = FengceGuardArtifact.abi as any;
const safeAbi = [
  { type: "function", name: "setGuard", inputs: [{ name: "guard", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setModuleGuard", inputs: [{ name: "moduleGuard", type: "address" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export async function usePolicy(owner: Address, safe: Address, pinId: Hex, schema: SchemaFile): Promise<{ hash: Hex; scheduled: boolean }> {
  const inst = await readInstalled(safe);
  const input = configInput({
    safe,
    guard: ENGINE.guard,
    pinId,
    schema,
    recoveryDelay: 172_800n,
    recoveryWindow: 172_800n,
    adminDelay: 86_400n,
    acceptExistingModules: true,
  } as never);
  const configure = encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [input] });
  const tx = inst.set
    ? { to: ENGINE.guard, data: encodeFunctionData({ abi: guardAbi, functionName: "scheduleAdmin", args: [ENGINE.guard, configure] }), operation: 0 as const }
    : multiSend([
        { to: ENGINE.guard, value: 0n, data: configure, label: "configure" },
        ...ROUTER_SELECTORS.map((sel) => ({ to: ENGINE.guard, value: 0n, label: "decoder", data: encodeFunctionData({ abi: guardAbi, functionName: "setDecoder", args: [ENGINE.router, sel, ENGINE.v3Decoder] }) as Hex })),
        { to: safe, value: 0n, label: "setGuard", data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [ENGINE.guard] }) },
        { to: safe, value: 0n, label: "setModuleGuard", data: encodeFunctionData({ abi: safeAbi, functionName: "setModuleGuard", args: [ENGINE.guard] }) },
      ]);
  const sim = await simulateSafeTx(owner, safe, tx);
  if (!sim.ok) throw new Error(`Refused before sending: ${sim.reason.text}.`);
  const r = await sendFromWallet(safe, sim.data);
  if (r.status !== "success") throw new Error("The transaction reverted on chain.");
  return { hash: r.hash, scheduled: inst.set };
}
