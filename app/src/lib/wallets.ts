/** Wallet compatibility, mirrored from docs/WALLETS.md (the source of truth; every cell there names its test). */
export type Guarantee = "checked" | "not restricted" | "not checked" | "not tested" | "gap" | "n/a";

export interface WalletRow {
  key: string;
  wallet: string;
  onXLayer: string;
  adapter: string;
  owner: { state: Guarantee; text: string };
  agents: { state: Guarantee; text: string };
  removal: { state: Guarantee; text: string };
  tests: string;
  /** shown in the Install picker */
  install?: string[];
}

export const WALLETS: WalletRow[] = [
  {
    key: "safe",
    wallet: "Safe v1.5.0",
    onXLayer: "yes",
    adapter: "FengceGuard (transaction guard and module guard)",
    owner: { state: "checked", text: "every owner transaction" },
    agents: { state: "checked", text: "AgentExecutor, through the module guard" },
    removal: { state: "checked", text: "admin timelock; removal only by recovery with all owners and at least a 2-day delay" },
    tests: "test/FengceGuard.t.sol, test/AgentExecutor.t.sol",
    install: ["Run the preflight below (existing approvals)", "Import the Transaction Builder JSON into the Safe", "Sign: configure, setGuard, setModuleGuard"],
  },
  {
    key: "safe7579",
    wallet: "Safe + Safe7579 v1.0.0",
    onXLayer: "Safe yes, Safe7579 adapter no",
    adapter: "FengceHook, with FengceGuard for Safe owner transactions",
    owner: { state: "checked", text: "checked" },
    agents: { state: "checked", text: "FengceGuard as module guard" },
    removal: { state: "gap", text: "Safe7579 does not run the hook on its own uninstall" },
    tests: "test/FengceHook7579.t.sol, test/FengceSafe7579Admin.t.sol",
  },
  {
    key: "kernel",
    wallet: "ZeroDev Kernel v3.3",
    onXLayer: "yes (v3.1 also deployed, not tested)",
    adapter: "FengceHook as the root validation's hook",
    owner: { state: "checked", text: "root user operations" },
    agents: { state: "not tested", text: "only validations or executors installed with FengceHook as their hook" },
    removal: { state: "checked", text: "hook uninstall waits 2 days; root validator changes and validator installs are scheduled admin actions (2 days)" },
    tests: "test/wallets/FengceKernel.t.sol",
    install: ["Create the account with FengceHook as the root validation's hook (1-byte flag, then abi.encode(pinId, layout, bindings))", "Admin changes: execute scheduleAdmin(keccak256(call)) on the hook, wait 2 days, then send the exact call"],
  },
  {
    key: "nexus",
    wallet: "Biconomy Nexus 1.2.0",
    onXLayer: "no",
    adapter: "FengceHook (global hook)",
    owner: { state: "checked", text: "checked" },
    agents: { state: "not tested", text: "executors go through executeFromExecutor, which runs the hook (from source)" },
    removal: { state: "gap", text: "uninstall waits 2 days, but emergencyUninstallHook (owner-signed, 1-day timelock) skips the hook (from source)" },
    tests: "test/wallets/FengceNexus.t.sol",
  },
  {
    key: "etherspot",
    wallet: "Etherspot ModularEtherspotWallet v1.0.0",
    onXLayer: "no",
    adapter: "FengceHook (global hook)",
    owner: { state: "checked", text: "checked" },
    agents: { state: "not tested", text: "not tested" },
    removal: { state: "gap", text: "uninstallModule does not run the hook: removable at once" },
    tests: "test/wallets/FengceEtherspot.t.sol",
  },
  {
    key: "mav2",
    wallet: "Alchemy Modular Account v2 (ERC-6900)",
    onXLayer: "yes",
    adapter: "FengceHook6900 (execution hooks from its manifest)",
    owner: { state: "checked", text: "every execute and executeBatch" },
    agents: { state: "checked", text: "any validation calling execute or executeBatch" },
    removal: { state: "checked", text: "uninstall and account upgrade wait 2 days" },
    tests: "test/wallets/FengceModularAccountV2.t.sol",
    install: ["installExecution(hook, hook.executionManifest(), abi.encode(pinId, layout, bindings))", "Removal: execute scheduleUninstall() on the hook, wait 2 days, then uninstallExecution"],
  },
  {
    key: "7702",
    wallet: "EIP-7702 EOA (SemiModularAccount7702)",
    onXLayer: "yes",
    adapter: "FengceHook6900",
    owner: { state: "not restricted", text: "the EOA key can always send a plain transaction" },
    agents: { state: "checked", text: "agents and session keys acting for the EOA" },
    removal: { state: "checked", text: "uninstall and upgrade wait 2 days (same module)" },
    tests: "test/wallets/Fengce7702.t.sol",
    install: ["Delegate the EOA to SemiModularAccount7702", "From the EOA: installExecution(FengceHook6900, manifest, config)", "Give agents a direct-call or session validation; their calls pass the circuit"],
  },
  {
    key: "metamask",
    wallet: "MetaMask 7702 DeleGator",
    onXLayer: "no",
    adapter: "none",
    owner: { state: "not restricted", text: "not restricted" },
    agents: { state: "n/a", text: "not supported: agents use delegations and caveat enforcers" },
    removal: { state: "n/a", text: "n/a" },
    tests: "none",
  },
  {
    key: "okx",
    wallet: "OKX Wallet (EIP-7702)",
    onXLayer: "not checked",
    adapter: "not sure which contract it delegates to",
    owner: { state: "not restricted", text: "not restricted" },
    agents: { state: "not tested", text: "if it delegates to an ERC-7579 or ERC-6900 account, the matching adapter applies" },
    removal: { state: "not tested", text: "not tested" },
    tests: "none",
  },
  {
    key: "coinbase",
    wallet: "Coinbase Smart Wallet v1.1",
    onXLayer: "no",
    adapter: "FengceAgentOwner (an extra owner)",
    owner: { state: "not checked", text: "no hook or module system exists" },
    agents: { state: "checked", text: "agents act only through FengceAgentOwner" },
    removal: { state: "n/a", text: "the wallet's owners can remove FengceAgentOwner at any time" },
    tests: "test/wallets/FengceAgentOwner.t.sol",
    install: ["addOwnerAddress(FengceAgentOwner)", "From the wallet: configure(pinId, layout, bindings), then addAgent(agent, expiresAt)", "Agents call FengceAgentOwner.execute(wallet, to, value, data)"],
  },
  {
    key: "lightmulti",
    wallet: "Alchemy MultiOwnerLightAccount v2",
    onXLayer: "yes",
    adapter: "FengceAgentOwner (same execute entry point)",
    owner: { state: "not checked", text: "not checked" },
    agents: { state: "not tested", text: "should work as for Coinbase Smart Wallet" },
    removal: { state: "n/a", text: "n/a" },
    tests: "none",
  },
  {
    key: "light",
    wallet: "Alchemy LightAccount v2 (single owner)",
    onXLayer: "yes",
    adapter: "none",
    owner: { state: "not checked", text: "not checked" },
    agents: { state: "n/a", text: "only by making FengceAgentOwner the single owner, which removes the owner's own access" },
    removal: { state: "n/a", text: "n/a" },
    tests: "none",
  },
];

/** Wallet types offered in the Install picker. */
export const INSTALL_TYPES: { key: string; label: string }[] = [
  { key: "safe", label: "Safe" },
  { key: "kernel", label: "Kernel" },
  { key: "mav2", label: "Modular Account v2" },
  { key: "7702", label: "7702 / agent" },
  { key: "coinbase", label: "Coinbase / agent" },
];

/** Pill tone for a guarantee cell. */
export function tone(g: Guarantee) {
  return g === "checked" ? "checked" : g === "gap" || g === "not restricted" || g === "not checked" ? "gap" : "neutral";
}

export type Coverage = "Full" | "Partial" | "Agent only" | "Not integrated";
/** Coverage per wallet, from the status column of docs/WALLETS.md (Mainnet and Fork-tested = Full). */
export const COVERAGE: Record<string, Coverage> = {
  safe: "Full",
  safe7579: "Partial",
  kernel: "Full",
  nexus: "Partial",
  etherspot: "Partial",
  mav2: "Full",
  "7702": "Agent only",
  coinbase: "Agent only",
  lightmulti: "Agent only",
  metamask: "Not integrated",
  okx: "Not integrated",
  light: "Not integrated",
};
/** Which deployed adapter a wallet uses, for the "Check a wallet" step (null: nothing to read). */
export const CHECK_ADAPTER: Record<string, "guard" | "hook7579" | "hook6900" | "agentOwner" | null> = {
  safe: "guard",
  safe7579: "hook7579",
  kernel: "hook7579",
  nexus: "hook7579",
  etherspot: "hook7579",
  mav2: "hook6900",
  "7702": "hook6900",
  coinbase: "agentOwner",
  lightmulti: "agentOwner",
  metamask: null,
  okx: null,
  light: null,
};
