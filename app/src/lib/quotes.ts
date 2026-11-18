import big from "../../../sdk/quotes/big-2046aa-3.json";
import comparator from "../../../sdk/quotes/comparator-f9bbdc-7.json";
import nand from "../../../sdk/quotes/nand-839bdd-2.json";
import nandFloor from "../../../sdk/quotes/nand-floor-b04eb7-3.json";
import nor from "../../../sdk/quotes/nor-87bfca-52.json";
import toggle from "../../../sdk/quotes/toggle-e2a6c6-18.json";
import xor from "../../../sdk/quotes/xor-b04eb7-5.json";

/** Stored Quote certificates (sdk/quotes): gas measured on the full Safe path on a fork of X Layer. */
export interface QuoteGas {
  tier: string;
  evalCall: string | null;
  fullPath: string | null;
  certificateHash: string;
}

const ALL = [big, comparator, nand, nandFloor, nor, toggle, xor] as unknown as {
  certificate: { processor: string; circuitId: string; tier: string; gas: { evalCall: string | null; fullPath: string | null } };
  certificateHash: string;
}[];

export function quoteFor(processor: string, id: bigint | string): QuoteGas | null {
  const q = ALL.find((x) => x.certificate.processor.toLowerCase() === processor.toLowerCase() && x.certificate.circuitId === String(id));
  return q ? { tier: q.certificate.tier, evalCall: q.certificate.gas.evalCall, fullPath: q.certificate.gas.fullPath, certificateHash: q.certificateHash } : null;
}
