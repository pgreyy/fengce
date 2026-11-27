// The Safe{Wallet} Transaction Builder file that /install builds: the guard v3 install as one batch (version 1.0). Shared
// with the fork check (app/scripts/install-create-fork.mts), which runs exactly this file's transactions.
import type { Address } from "viem";
import type { v3InstallCalls } from "./v3";

/** Safe{Wallet} Transaction Builder batch file (version 1.0). The builder groups the calls into one MultiSend. */
export function batchFile(safe: Address, calls: ReturnType<typeof v3InstallCalls>, maxPerBuy: number, perHour: number, tilt: boolean) {
  return {
    version: "1.0",
    chainId: "196",
    createdAt: Date.now(),
    meta: {
      name: "Fengce: install limits",
      description: `Installs FengceGuardV3 on this Safe: max per buy ${maxPerBuy} USDT0${perHour ? `, ${perHour} trades per clock hour (UTC)` : ""}${tilt ? ", Tilt-shield on (4 buys in the same half hour pause buys for 6 hours)" : ""}. Built at getfengce.vercel.app/install for ${safe}.`,
      txBuilderVersion: "1.16.5",
      createdFromSafeAddress: safe,
      createdFromOwnerAddress: "",
    },
    transactions: calls.map((c) => ({ to: c.to, value: c.value.toString(), data: c.data, contractMethod: null, contractInputsValues: null })),
  };
}

