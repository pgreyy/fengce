// Writes test/vectors/limits-install.json: the exact bytes the app sends for a one-signature install and for two swaps,
// for a fixed Safe and placeholder pins. test/fork/LimitsInstall.t.sol rebuilds the same bytes in Solidity, checks they
// are equal, then runs them on a fork with real pins. Usage: npx tsx scripts/limits-vectors.mts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { TOKENS, counterSchemaHash, execCalldata, installCalls, maxBuySchemaHash, multiSend, swapCalls, tickGroupId, type Prepared } from "../src/fengce/engine";

const safe = getAddress("0x0000000000000000000000000000000000004f4b");
const owner = getAddress("0x00000000000000000000000000000000000a11ce");
const pin = (s: string) => keccak256(toHex(s)) as Hex;
const prepared: Prepared = {
  counterProcessor: getAddress("0x7335a50819d44402e3D5E00239bBB80A13E7308F"),
  counterCircuitId: "0",
  maxBuyPin: pin("placeholder.maxBuyPin"),
  counterPins: Object.fromEntries([...Array(15).keys()].map((i) => [String(i + 1), pin(`placeholder.counterPin.${i + 1}`)])),
};
const limits = { maxPerBuy: 1_000_000n, tradesPerHour: 2 };
const install = multiSend(installCalls(safe, limits, prepared));
const swap = (amount: bigint) => multiSend(swapCalls(safe, TOKENS.USDT0.address, TOKENS.WOKB.address, amount, 0n));
const out = {
  safe,
  owner,
  maxPerBuy: limits.maxPerBuy.toString(),
  tradesPerHour: limits.tradesPerHour,
  maxBuyPin: prepared.maxBuyPin,
  counterPin: prepared.counterPins[String(limits.tradesPerHour)],
  maxBuySchemaHash: maxBuySchemaHash(),
  counterSchemaHash: counterSchemaHash(limits.tradesPerHour),
  tickGroup: tickGroupId(safe),
  installMultiSend: install.data,
  installExec: execCalldata(owner, install),
  swapIn: swap(500_000n).data,
  swapOver: swap(1_500_000n).data,
};
writeFileSync(resolve(import.meta.dirname, "../../contracts/test/vectors/limits-install.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote test/vectors/limits-install.json", { installBytes: (install.data.length - 2) / 2, calls: installCalls(safe, limits, prepared).length });
