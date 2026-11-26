// Browser wallets (EIP-6963: OKX Wallet, MetaMask and any other injected wallet), the X Layer network, and the Safe the
// connected owner uses. Nothing here holds keys: the wallet signs, this code only builds and simulates calls.
import { useEffect, useState } from "react";
import { createWalletClient, custom, decodeErrorResult, getAddress, isAddress, parseAbi, type Abi, type Address, type Hex } from "viem";
import { FengceGuardArtifact, TickArtifact } from "@fengce/sdk";
import { client } from "../lib/chain";
import { TOKENS, execCalldata } from "./engine";

interface Eip1193 {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, fn: (...a: any[]) => void) => void;
}
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193;
}

const XLAYER = { id: 196, hex: "0xc4", name: "X Layer", rpc: "https://rpc.xlayer.tech", explorer: "https://www.oklink.com/x-layer" };

const store = {
  wallets: [] as WalletInfo[],
  account: null as Address | null,
  wallet: null as WalletInfo | null,
  safe: null as Address | null,
  chainOk: true,
};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function safeKey(owner: Address) {
  return `okun-safe:${owner.toLowerCase()}`;
}
function load(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function save(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

// ------------------------------------------------------------------ discovery (EIP-6963)
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent).detail as { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 };
    if (!d?.info || store.wallets.some((w) => w.uuid === d.info.uuid)) return;
    store.wallets = [...store.wallets, { ...d.info, provider: d.provider }];
    emit();
    void reconnect();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Wallets that predate EIP-6963 only expose window.ethereum.
  setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Eip1193 & { isOkxWallet?: boolean; isMetaMask?: boolean } }).ethereum;
    if (eth && store.wallets.length === 0) {
      store.wallets = [{ uuid: "injected", name: eth.isOkxWallet ? "OKX Wallet" : eth.isMetaMask ? "MetaMask" : "Browser wallet", icon: "", rdns: "injected", provider: eth }];
      emit();
      void reconnect();
    }
  }, 400);
}

/** Silent reconnect to the wallet used last time (no popup). */
async function reconnect() {
  if (store.account) return;
  const last = load("okun-wallet");
  const w = store.wallets.find((x) => x.rdns === last || x.uuid === last);
  if (!w) return;
  try {
    const [a] = (await w.provider.request({ method: "eth_accounts" })) as string[];
    if (a) await setAccount(w, getAddress(a));
  } catch {
    /* not authorised any more */
  }
}

async function setAccount(w: WalletInfo, a: Address) {
  store.wallet = w;
  store.account = a;
  const s = load(safeKey(a));
  store.safe = s && isAddress(s) ? getAddress(s) : null;
  save("okun-wallet", w.rdns || w.uuid);
  try {
    store.chainOk = ((await w.provider.request({ method: "eth_chainId" })) as string).toLowerCase() === XLAYER.hex;
  } catch {
    store.chainOk = false;
  }
  w.provider.on?.("accountsChanged", (as: string[]) => {
    if (!as[0]) disconnect();
    else void setAccount(w, getAddress(as[0]));
  });
  w.provider.on?.("chainChanged", (id: string) => {
    store.chainOk = id.toLowerCase() === XLAYER.hex;
    emit();
  });
  emit();
}

export async function connect(w: WalletInfo): Promise<Address> {
  const [a] = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
  await ensureXLayer(w);
  await setAccount(w, getAddress(a));
  return getAddress(a);
}

export async function ensureXLayer(w: WalletInfo = store.wallet!) {
  try {
    await w.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
  } catch {
    await w.provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: XLAYER.hex, chainName: XLAYER.name, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: [XLAYER.rpc], blockExplorerUrls: [XLAYER.explorer] }],
    });
  }
  store.chainOk = true;
  emit();
}

export function disconnect() {
  store.account = null;
  store.wallet = null;
  store.safe = null;
  save("okun-wallet", null);
  emit();
}

export function chooseSafe(safe: Address | null) {
  if (!store.account) return;
  store.safe = safe;
  save(safeKey(store.account), safe);
  if (safe) rememberSafe(store.account, safe);
  emit();
}

/** Every Safe this browser has used or created for an owner (newest first). */
export function rememberedSafes(owner: Address): Address[] {
  try {
    const v = JSON.parse(load(`okun-safes:${owner.toLowerCase()}`) ?? "[]") as string[];
    const cur = load(safeKey(owner));
    return [...new Set([...(cur ? [cur] : []), ...v].filter((x) => isAddress(x)).map((x) => getAddress(x)))];
  } catch {
    return [];
  }
}
function rememberSafe(owner: Address, safe: Address) {
  const list = [getAddress(safe), ...rememberedSafes(owner).filter((x) => x.toLowerCase() !== safe.toLowerCase())].slice(0, 20);
  save(`okun-safes:${owner.toLowerCase()}`, JSON.stringify(list));
}

export function useWallet() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { ...store };
}

// ------------------------------------------------------------------ Safe checks

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
]);

export async function safeInfo(safe: Address) {
  const [owners, threshold, version] = await Promise.all([
    client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    client.readContract({ address: safe, abi: safeAbi, functionName: "VERSION" }),
  ]);
  return { owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), version };
}

const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
export async function balances(safe: Address) {
  const entries = await Promise.all(
    Object.values(TOKENS).map(async (t) => [t.symbol, await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [safe] })] as const),
  );
  return Object.fromEntries(entries) as Record<string, bigint>;
}

// ------------------------------------------------------------------ sending through the Safe

const SAFE_ERRORS = parseAbi(["error GS013()", "error GS025()"]);
const KNOWN: Abi = [...(FengceGuardArtifact.abi as Abi), ...(TickArtifact.abi as Abi)];

/** Plain-language reason for a refused Safe transaction. */
export function reasonOf(data: Hex | undefined, message?: string): { code: string; text: string } {
  if (data && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi: KNOWN, data });
      switch (d.errorName) {
        case "FengceDenied":
          return { code: "LIMIT", text: "a limit refused it: this would pay more USDT0 than your max per buy" };
        case "TickDenied":
          return { code: "RATE", text: "trades per hour used up for this clock hour" };
        case "AdminNotReady":
          return { code: "WAIT", text: "this change is scheduled and its 1-day wait has not ended" };
        case "FengceGuardCallDenied":
        case "FengceSafeCallDenied":
          return { code: "WAIT", text: "changing your limits needs the 1-day wait: request the change first" };
        case "TxUnsupportedCall":
          return { code: "UNSUPPORTED", text: "your limits only allow calls they can read; this one is not supported" };
        case "FengceExistingApprovals":
          return { code: "APPROVALS", text: "this Safe already has token approvals; revoke them before installing" };
        case "FengceModulesEnabled":
          return { code: "MODULES", text: "this Safe has modules enabled; disable them before installing" };
        default:
          return { code: d.errorName, text: d.errorName };
      }
    } catch {
      try {
        const s = decodeErrorResult({ abi: SAFE_ERRORS, data });
        if (s.errorName === "GS013") return { code: "FAILED", text: "the transaction itself failed (for example not enough balance)" };
      } catch {
        /* unknown */
      }
    }
  }
  if (message && /GS013/.test(message)) return { code: "FAILED", text: "the transaction itself failed (for example not enough balance)" };
  if (message && /GS026|GS020|GS025/.test(message)) return { code: "OWNER", text: "the connected wallet is not an owner of this Safe, or the Safe needs more signatures" };
  return { code: "REVERT", text: message?.split("\n")[0] ?? "reverted" };
}

function revertData(e: unknown): Hex | undefined {
  let c: any = e;
  for (let i = 0; i < 8 && c; i++) {
    if (typeof c.data === "string" && c.data.startsWith("0x")) return c.data as Hex;
    if (c.data?.data && typeof c.data.data === "string") return c.data.data as Hex;
    c = c.cause;
  }
  return undefined;
}

/** Simulates execTransaction from the owner, as the wallet would send it. */
export async function simulateSafeTx(owner: Address, safe: Address, tx: { to: Address; data: Hex; operation: 0 | 1 }) {
  const data = execCalldata(owner, tx);
  try {
    await client.call({ account: owner, to: safe, data });
    return { ok: true as const, data };
  } catch (e) {
    return { ok: false as const, data, reason: reasonOf(revertData(e), (e as Error).message) };
  }
}

/** Sends a call from the connected wallet and waits for it. `gas` forces sending a transaction the node expects to revert
 * (to record a refusal on chain). */
export async function sendFromWallet(to: Address, data: Hex, gas?: bigint): Promise<{ hash: Hex; status: "success" | "reverted" }> {
  const w = store.wallet;
  const account = store.account;
  if (!w || !account) throw new Error("Connect a wallet first");
  await ensureXLayer(w);
  const wc = createWalletClient({ account, transport: custom(w.provider), chain: { id: 196, name: "X Layer", nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 }, rpcUrls: { default: { http: [XLAYER.rpc] } } } });
  const hash = await wc.sendTransaction({ to, data, gas });
  const r = await client.waitForTransactionReceipt({ hash });
  return { hash, status: r.status };
}

export const EXPLORER_TX = (h: string) => `${XLAYER.explorer}/tx/${h}`;
export const EXPLORER_ADDR = (a: string) => `${XLAYER.explorer}/address/${a}`;
