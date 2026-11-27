// Fengce limits: the transactions the app asks a Safe owner to sign, built as pure functions so the same bytes are
// checked by the fork test (test/fork/LimitsInstall.t.sol reads test/vectors/limits-install.json, written from here).
import { concat, encodeFunctionData, encodePacked, getAddress, keccak256, padHex, parseAbi, size, type Address, type Hex } from "viem";
import { FengceGuardArtifact, TickArtifact, schemaHash, toLayout, type SchemaFile } from "@fengce/sdk";
import counter from "../../../contracts/circuits/trade-counter.json";
import deployment from "../../../deployments/xlayer-196-v2.json";

export const ENGINE = {
  guard: getAddress(deployment.contracts.FengceGuard),
  tick: getAddress(deployment.contracts.Tick),
  pinRegistry: getAddress(deployment.contracts.PinRegistry),
  v3Decoder: getAddress(deployment.contracts.UniswapV3RouterDecoder),
  multiSendCallOnly: getAddress("0xA83c336B20401Af773B6219BA5027174338D1836"),
  safeFactory: getAddress("0x14F2982D601c9458F93bd70B218933A6f8165e7b"),
  safeL2: getAddress("0xEdd160fEBBD92E350D4D398fb636302fccd67C7e"),
  fallbackHandler: getAddress("0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4"),
  router: getAddress("0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA"), // Uniswap SwapRouter02 on X Layer
} as const;

export const TOKENS = {
  USDT0: { address: getAddress("0x779Ded0c9e1022225f8E0630b35a9b54bE713736"), decimals: 6, symbol: "USDT0" },
  WOKB: { address: getAddress("0xe538905cf8410324e03A5A23C1c177a474D59b2b"), decimals: 18, symbol: "OKB" },
  USDC: { address: getAddress("0xB6CEceAB302E2E4948951eE7843FC24E92933061"), decimals: 6, symbol: "USDC" },
} as const;

/** Waits: loosening (any change to the limits) 1 day; removing the guard 2 days with every owner, then a 2-day window. */
export const DELAYS = { adminDelay: 86_400n, recoveryDelay: 172_800n, recoveryWindow: 172_800n } as const;
/** Tick period for "trades per hour": each clock hour (UTC). */
export const TRADE_PERIOD = 3_600n;
/** SwapRouter02 calls FengceGuard can decode (UniswapV3RouterDecoder): exactInputSingle, exactInput, exactOutputSingle, exactOutput. */
export const ROUTER_SELECTORS: Hex[] = ["0x04e45aaf", "0xb858183f", "0x5023b4df", "0x09b81346"];

// ------------------------------------------------------------------ the two circuits

/** Max per buy: the deployed 2-input NAND (processor 0x839b…74e circuit #2). in0 = amount over the cap, in1 = paying
 * USDT0; the wallet refuses only when both are 1. */
export const MAX_BUY_CIRCUIT = {
  processor: getAddress("0x839bdD6fa7A66416A609A735e11DE5411B98574e"),
  id: 2n,
  netlist: "0x000000020000030000000400000400000005000005" as Hex,
};
export function maxBuySchema(): SchemaFile {
  return {
    format: "fengce-schema/1",
    netlistHash: keccak256(MAX_BUY_CIRCUIT.netlist),
    nIn: 2,
    fields: [
      { name: "overCap", kind: "bool", offset: 0, width: 1 },
      { name: "isUsdt0", kind: "bool", offset: 1, width: 1 },
    ],
  };
}
/** Trades per hour: our counter circuit (circuits/trade-counter.json). N is fixed per pin with four Flag fields. */
export const COUNTER = { netlist: counter.netlist as Hex, nIn: counter.nIn, nState: counter.nState, gates: counter.gates, latches: counter.latches };
export function counterSchema(n: number): SchemaFile {
  if (!Number.isInteger(n) || n < 1 || n > 15) throw new Error("trades per hour must be 1 to 15");
  return {
    format: "fengce-schema/1",
    netlistHash: keccak256(COUNTER.netlist),
    nIn: 7,
    fields: [
      { name: "kind", kind: "uint", offset: 0, width: 3 },
      ...[0, 1, 2, 3].map((b) => ({ name: `n${b}`, kind: "flag" as const, offset: 3 + b, width: 1, value: (n >> b) & 1 })),
    ],
  };
}
export const maxBuySchemaHash = () => schemaHash(maxBuySchema());
export const counterSchemaHash = (n: number) => schemaHash(counterSchema(n));

/** What script/PrepareLimits.s.sol writes to deployments/limits-xlayer-196.json after the owner broadcasts it. */
export interface Prepared {
  counterProcessor: Address;
  counterCircuitId: string;
  maxBuyPin: Hex;
  counterPins: Record<string, Hex>; // "1".."15"
}

// ------------------------------------------------------------------ install

export interface Limits {
  /** most USDT0 one buy or send can spend, in base units (6 decimals) */
  maxPerBuy: bigint;
  /** swaps allowed per clock hour, 0 = no limit */
  tradesPerHour: number;
}
export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
  label: string;
}

const safeAbi = parseAbi([
  "function setGuard(address guard)",
  "function setModuleGuard(address moduleGuard)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);
const factoryAbi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);
const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function transfer(address to, uint256 amount) returns (bool)"]);
const routerAbi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

/** ABIs used to read transactions back (Activity). */
export const ABIS = { safe: safeAbi, multiSend: multiSendAbi, erc20: erc20Abi, router: routerAbi };

/** The guard's configure() input for "max per buy". */
export function configureInput(limits: Limits, prepared: Prepared) {
  const s = maxBuySchema();
  return {
    pinId: prepared.maxBuyPin,
    layout: toLayout(s),
    bindings: [
      { source: 5, param: limits.maxPerBuy }, // AmountGt(cap)
      { source: 7, param: BigInt(TOKENS.USDT0.address) }, // TokenIs(USDT0)
    ],
    recoveryDelay: DELAYS.recoveryDelay,
    recoveryWindow: DELAYS.recoveryWindow,
    adminDelay: DELAYS.adminDelay,
    preflightTokens: [TOKENS.USDT0.address],
    preflightSpenders: [ENGINE.router],
    acceptExistingApprovals: false,
    acceptExistingModules: false,
  };
}

export const TICK_SALT = keccak256(new TextEncoder().encode("okun.trades-per-hour.v1"));
export function tickGroupId(safe: Address): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [padHex(getAddress(safe), { size: 32 }), TICK_SALT]));
}

/** Every call of the one-signature install, in order. The guard is set last: until then nothing in the batch is checked. */
export function installCalls(safe: Address, limits: Limits, prepared: Prepared): Call[] {
  const guardAbi = FengceGuardArtifact.abi as any;
  const calls: Call[] = [
    { to: ENGINE.guard, value: 0n, label: "Set max per buy (FengceGuard.configure)", data: encodeFunctionData({ abi: guardAbi, functionName: "configure", args: [configureInput(limits, prepared)] }) },
    ...ROUTER_SELECTORS.map((sel) => ({
      to: ENGINE.guard,
      value: 0n,
      label: `Read swaps on SwapRouter02 (${sel})`,
      data: encodeFunctionData({ abi: guardAbi, functionName: "setDecoder", args: [ENGINE.router, sel, ENGINE.v3Decoder] }),
    })),
  ];
  if (limits.tradesPerHour > 0) {
    const n = limits.tradesPerHour;
    const s = counterSchema(n);
    const pin = prepared.counterPins[String(n)];
    if (!pin) throw new Error(`no pin for ${n} trades per hour`);
    const tickAbi = TickArtifact.abi as any;
    const group = tickGroupId(safe);
    const layout = toLayout(s);
    calls.push(
      { to: ENGINE.tick, value: 0n, label: `Count swaps per hour (Tick.createGroup, ${n} per hour)`, data: encodeFunctionData({ abi: tickAbi, functionName: "createGroup", args: [TICK_SALT, pin, TRADE_PERIOD, layout, [{ source: 4, param: 0n }]] }) },
      { to: ENGINE.tick, value: 0n, label: "Add this Safe to its counter (Tick.setMember)", data: encodeFunctionData({ abi: tickAbi, functionName: "setMember", args: [group, safe, true] }) },
      { to: ENGINE.tick, value: 0n, label: "Let the guard advance the counter (Tick.setRelayer)", data: encodeFunctionData({ abi: tickAbi, functionName: "setRelayer", args: [ENGINE.guard, true] }) },
      { to: ENGINE.guard, value: 0n, label: "Use the counter (FengceGuard.configureTick)", data: encodeFunctionData({ abi: guardAbi, functionName: "configureTick", args: [ENGINE.tick, group] }) },
    );
  }
  calls.push(
    { to: safe, value: 0n, label: "Turn on the guard (Safe.setGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [ENGINE.guard] }) },
    { to: safe, value: 0n, label: "Guard modules and agents too (Safe.setModuleGuard)", data: encodeFunctionData({ abi: safeAbi, functionName: "setModuleGuard", args: [ENGINE.guard] }) },
  );
  return calls;
}

/** Packs calls into one MultiSendCallOnly delegatecall. */
export function multiSend(calls: Call[]): { to: Address; data: Hex; operation: 1 } {
  const packed = concat(calls.map((c) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, c.value, BigInt(size(c.data)), c.data])));
  return { to: ENGINE.multiSendCallOnly, data: encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] }), operation: 1 };
}

/** A pre-validated signature for a 1-of-1 Safe: v = 1 means "the sender of execTransaction is this owner". */
export function ownerSignature(owner: Address): Hex {
  return concat([padHex(getAddress(owner), { size: 32 }), padHex("0x00", { size: 32 }), "0x01"]);
}

/** execTransaction calldata the owner sends to their Safe (one signature, threshold 1). */
export function execCalldata(owner: Address, tx: { to: Address; value?: bigint; data: Hex; operation: 0 | 1 }): Hex {
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  return encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [tx.to, tx.value ?? 0n, tx.data, tx.operation, 0n, 0n, 0n, zero, zero, ownerSignature(owner)],
  });
}

/** A new 1-of-1 Safe v1.5 (L2) for `owner`: the factory call and the deterministic salt. */
export function createSafeCalldata(owner: Address, saltNonce: bigint): Hex {
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  const init = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[getAddress(owner)], 1n, zero, "0x", ENGINE.fallbackHandler, zero, 0n, zero] });
  return encodeFunctionData({ abi: factoryAbi, functionName: "createProxyWithNonce", args: [ENGINE.safeL2, init, saltNonce] });
}

// ------------------------------------------------------------------ swap and send through the Safe

/** Approve exactly the amount, then swap on SwapRouter02 with the output back to the Safe. Both calls are checked. */
export function swapCalls(safe: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, minOut: bigint, fee = 500): Call[] {
  return [
    { to: tokenIn, value: 0n, label: "Approve the router for this amount", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ENGINE.router, amountIn] }) },
    {
      to: ENGINE.router,
      value: 0n,
      label: "Swap on Uniswap V3",
      data: encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee, recipient: getAddress(safe), amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] }),
    },
  ];
}

export function sendCall(token: Address, to: Address, amount: bigint): Call {
  return { to: token, value: 0n, label: "Send", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) };
}
