// Limits → Templates: three ready-made setups built only from what guard v3 and the existing circuits already do. Each
// installs on a Safe with no guard yet, in one signature (one MultiSend batch, guard turned on last).
import { encodeFunctionData, type Address, type Hex } from "viem";
import { FengceGuardArtifact, TickArtifact, parseSchema, toLayout, type SchemaFile } from "@fengce/sdk";
import { catalogGroupId, catalogSalt } from "./catalogInstall";
import { ENGINE, type Call, type Prepared } from "./engine";
import { V3, V3_DEFAULTS, v3InstallCalls } from "./v3";

export type TemplateKey = "admin" | "vault" | "treasury";

export interface TemplateInfo {
  key: TemplateKey;
  name: string;
  tagline: string;
  who: string;
  blocks: string[];
  rules: string[];
  /** the honest gap: what was asked that guard v3 cannot do today */
  gap: string;
}

export const TEMPLATES: TemplateInfo[] = [
  {
    key: "admin",
    name: "Admin key guard",
    tagline: "For the keys that can change everything.",
    who: "Protocol multisigs and admin Safes: the Safe that owns upgrades, treasuries or bridges.",
    blocks: [
      "Delegatecalls to any contract other than Safe's MultiSendCallOnly (the Bybit path: signers approved a delegatecall that rewrote the Safe)",
      "Adding or removing owners, changing the threshold, enabling modules, right away (the WazirX and Radiant paths: control moved in one signed transaction)",
      "Removing the guard without every owner and a 2-day wait",
    ],
    rules: [
      "Owner, threshold and module changes are loosening: scheduled in public, they apply after 1 day.",
      "Removing the guard takes every owner and waits 2 days.",
      "Payments over your cap per transaction are refused (max per buy, circuit #2).",
    ],
    gap: "Gap: the delegatecall allowlist is fixed to MultiSendCallOnly; guard v3 cannot add other delegatecall targets.",
  },
  {
    key: "vault",
    name: "Vault",
    tagline: "Small sends now, big ones tomorrow.",
    who: "Savings and cold storage: money you rarely move and never want to lose in one transaction.",
    blocks: ["Any single USDT0 send or buy over your cap", "Raising the cap without a public 1-day wait (7 days with a partner, unless they approve sooner)"],
    rules: [
      "Sends up to your cap go through at once.",
      "Anything bigger is refused. To move more, schedule a higher cap: it applies after 1 day, or earlier if your partner approves.",
      "Lowering the cap applies at once.",
    ],
    gap: "Gap: the cap counts USDT0 only (circuit #2 with 'token paid is USDT0'); other tokens are not capped by it.",
  },
  {
    key: "treasury",
    name: "Treasury",
    tagline: "A cap per payment and a budget per period.",
    who: "Teams paying contributors, grants and vendors from one Safe.",
    blocks: ["Any single USDT0 payment over your cap", "More than one payment per period (the Catalog's Periodic Spending Budget, circuit #18, through Tick)"],
    rules: ["Each payment: at most your cap in USDT0.", "One transaction per period; the budget resets at the start of each period you choose.", "Loosening either waits 1 day."],
    gap: "Gap: guard v3 runs one policy circuit plus one Tick circuit, so a recipient allowlist cannot sit next to the cap and budget, and a daily outflow amount cap is not supported (the budget counts transactions, not amounts).",
  },
];

export interface TemplateOptions {
  cap: bigint; // USDT0 base units
  partner?: Address;
  /** treasury: the Periodic Spending Budget (#18) Catalog pin, its schema (netlistHash filled) and the period */
  budget?: { pinId: Hex; schema: SchemaFile; period: bigint };
}

/** Every call of the one-signature install of a template on a Safe with no guard. */
export function templateCalls(key: TemplateKey, safe: Address, o: TemplateOptions, prepared: Prepared): Call[] {
  if (!V3) throw new Error("guard v3 is not deployed");
  const base = { ...V3_DEFAULTS, tiltOn: false, maxPerBuy: o.cap, tradesPerHour: 0, partner: key === "vault" ? o.partner : undefined };
  const calls = v3InstallCalls(safe, base, prepared);
  if (key !== "treasury") return calls;
  if (!o.budget) throw new Error("the budget circuit is not loaded");
  const s = parseSchema(o.budget.schema);
  const group = catalogGroupId(safe, o.budget.pinId);
  const at = calls.findIndex((c) => c.label.includes("setRules"));
  calls.splice(
    at,
    0,
    { to: ENGINE.tick, value: 0n, label: "Budget: one transaction per period (Tick.createGroup, circuit #18)", data: encodeFunctionData({ abi: TickArtifact.abi as any, functionName: "createGroup", args: [catalogSalt(o.budget.pinId), o.budget.pinId, o.budget.period, toLayout(s), []] }) },
    { to: ENGINE.tick, value: 0n, label: "Add this Safe to the budget (Tick.setMember)", data: encodeFunctionData({ abi: TickArtifact.abi as any, functionName: "setMember", args: [group, safe, true] }) },
    { to: V3.guard, value: 0n, label: "Run the budget on every transaction (configureTick)", data: encodeFunctionData({ abi: FengceGuardArtifact.abi as any, functionName: "configureTick", args: [ENGINE.tick, group] }) },
  );
  return calls;
}
