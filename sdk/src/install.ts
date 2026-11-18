import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  encodeFunctionData,
  encodePacked,
  getAddress,
  parseAbi,
  size,
} from "viem";
import { FengceGuardArtifact } from "./artifacts.js";
import { BINDING_SOURCES, type SchemaFile, parseSchema, toLayout } from "./schema.js";

/** MultiSendCallOnly v1.5.0 (same address on every chain with canonical Safe deployments). */
export const MULTI_SEND_CALL_ONLY: Address = "0xA83c336B20401Af773B6219BA5027174338D1836";
const SENTINEL: Address = "0x0000000000000000000000000000000000000001";

const safeReadAbi = parseAbi([
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);
const safeAdminAbi = parseAbi([
  "function setGuard(address guard)",
  "function setModuleGuard(address moduleGuard)",
  "function setFallbackHandler(address handler)",
  "function setDomainVerifier(bytes32 domainSeparator, address verifier)",
]);
const domainAbi = parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]);

/** Safe ExtensibleFallbackHandler v1.5.0 (keeps a default path for unknown signature domains). */
export const EXTENSIBLE_FALLBACK_HANDLER: Address = "0x85a8ca358D388530ad0fB95D0cb89Dd44Fc242c3";
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** EIP-712 domain separator of Permit2 or of an EIP-2612 token, read from the contract. */
export async function domainSeparatorOf(client: PublicClient, contract: Address): Promise<Hex> {
  return client.readContract({ address: contract, abi: domainAbi, functionName: "DOMAIN_SEPARATOR" });
}
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

export interface InstallOptions {
  safe: Address;
  guard: Address; // deployed FengceGuard
  pinId: Hex;
  schema: SchemaFile; // must include bindings
  recoveryDelay: bigint; // seconds, >= 2 days
  recoveryWindow: bigint; // seconds, >= 1 day
  adminDelay: bigint; // seconds, >= 1 day
  preflightTokens?: Address[];
  preflightSpenders?: Address[];
  acceptExistingApprovals?: boolean;
  /** configure() reverts if the Safe has modules enabled unless this is set (then emits a warning per module). */
  acceptExistingModules?: boolean;
  /**
   * Off-chain signature path: install `handler` as the Safe's fallback handler and delegate each domain
   * (Permit2 and EIP-2612 token domains, see domainSeparatorOf) to the Fengce verifier. Use
   * FengceStrictHandler for Strict Signatures mode (unknown domains rejected), or
   * EXTENSIBLE_FALLBACK_HANDLER to keep Safe's default path for other domains.
   */
  signatures?: { handler: Address; verifier: Address; domains: Hex[] };
}

export interface SafeCall {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1; // 0 call, 1 delegatecall
  description: string;
}

export class InstallError extends Error {}

/** On-chain minimums (src/safe/FengceLimits.sol); configure reverts below them. Seconds. */
export const MIN_DELAYS = { recoveryDelay: 172_800n, recoveryWindow: 86_400n, adminDelay: 86_400n } as const;

/** The FengceGuard.ConfigInput struct for `configure`, from a schema file with bindings. */
export function configInput(o: InstallOptions) {
  const s = parseSchema(o.schema);
  if (!s.bindings) throw new InstallError("schema has no bindings; FengceGuard needs one binding per non-flag field");
  const order = s.fields.filter((f) => f.kind !== "flag").map((f) => f.name);
  const bindings = order.map((name) => {
    const b = s.bindings!.find((x) => x.field === name)!;
    return { source: BINDING_SOURCES.indexOf(b.source), param: BigInt(b.param ?? 0) };
  });
  for (const k of ["recoveryDelay", "recoveryWindow", "adminDelay"] as const) {
    if (o[k] < MIN_DELAYS[k]) throw new InstallError(`${k} must be at least ${MIN_DELAYS[k]} seconds (on-chain minimum)`);
  }
  return {
    pinId: o.pinId,
    layout: toLayout(s),
    bindings,
    recoveryDelay: o.recoveryDelay,
    recoveryWindow: o.recoveryWindow,
    adminDelay: o.adminDelay,
    preflightTokens: o.preflightTokens ?? [],
    preflightSpenders: o.preflightSpenders ?? [],
    acceptExistingApprovals: o.acceptExistingApprovals ?? false,
    acceptExistingModules: o.acceptExistingModules ?? false,
  };
}

/** Modules currently enabled on a Safe (reads up to 50). */
export async function enabledModules(client: PublicClient, safe: Address): Promise<Address[]> {
  const [modules] = await client.readContract({ address: safe, abi: safeReadAbi, functionName: "getModulesPaginated", args: [SENTINEL, 50n] });
  return [...modules];
}

/**
 * Builds the Safe transactions that install Fengce, in order: configure (Safe -> guard), optionally
 * setFallbackHandler + setDomainVerifier per domain, then setGuard(guard), setModuleGuard(guard).
 * It only builds calldata; it sends nothing.
 * Refuses a Safe that already has modules enabled: a module can act before the module guard is
 * installed, and Fengce's checks assume the owners know every module.
 */
export async function buildInstall(client: PublicClient, o: InstallOptions): Promise<{ calls: SafeCall[]; multiSend: SafeCall }> {
  const modules = await enabledModules(client, o.safe);
  if (modules.length > 0) throw new InstallError(`Safe ${o.safe} has modules enabled (${modules.join(", ")}); disable them before installing Fengce`);
  const guard = getAddress(o.guard);
  const safe = getAddress(o.safe);
  const calls: SafeCall[] = [
    {
      to: guard,
      value: 0n,
      data: encodeFunctionData({ abi: FengceGuardArtifact.abi, functionName: "configure", args: [configInput(o)] as any }),
      operation: 0,
      description: "FengceGuard.configure (called by the Safe)",
    },
  ];
  // Handler and domain verifiers go in before the guard: afterwards each change needs the admin timelock.
  if (o.signatures) {
    if (o.signatures.domains.length === 0) throw new InstallError("signatures.domains is empty");
    calls.push({
      to: safe, value: 0n, operation: 0, description: "Safe.setFallbackHandler",
      data: encodeFunctionData({ abi: safeAdminAbi, functionName: "setFallbackHandler", args: [getAddress(o.signatures.handler)] }),
    });
    for (const d of o.signatures.domains) {
      calls.push({
        to: safe, value: 0n, operation: 0, description: `setDomainVerifier ${d.slice(0, 10)}…`,
        data: encodeFunctionData({ abi: safeAdminAbi, functionName: "setDomainVerifier", args: [d, getAddress(o.signatures.verifier)] }),
      });
    }
  }
  calls.push(
    { to: safe, value: 0n, data: encodeFunctionData({ abi: safeAdminAbi, functionName: "setGuard", args: [guard] }), operation: 0, description: "Safe.setGuard" },
    { to: safe, value: 0n, data: encodeFunctionData({ abi: safeAdminAbi, functionName: "setModuleGuard", args: [guard] }), operation: 0, description: "Safe.setModuleGuard" },
  );
  return { calls, multiSend: toMultiSend(calls) };
}

/** Packs plain calls into one delegatecall to MultiSendCallOnly. */
export function toMultiSend(calls: SafeCall[]): SafeCall {
  const packed = concat(
    calls.map((c) => {
      if (c.operation !== 0) throw new InstallError("MultiSendCallOnly accepts calls only");
      return encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, c.value, BigInt(size(c.data)), c.data]);
    }),
  );
  return {
    to: MULTI_SEND_CALL_ONLY,
    value: 0n,
    data: encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [packed] }),
    operation: 1,
    description: `MultiSendCallOnly batch of ${calls.length} calls`,
  };
}
