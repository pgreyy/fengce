import { bytesToHex, getAddress, type Address, type Hex, hexToBytes } from "viem";

/** One REF record of a TapeOut netlist (TAP-02 section 2). */
export interface Ref {
  cpu: Address;
  id: bigint;
  nIns: number;
  nOuts: number;
}

/**
 * Strict netlist decoder, same rules as src/core/Netlist.sol:
 * NAND 0x00 (7 bytes), LATCH 0x01 (4 bytes), REF 0x02 (31 + 3*nIns bytes); big-endian.
 * Throws on an unknown opcode or a truncated record.
 */
export function parseRefs(netlist: Hex): { refs: Ref[]; nand: number; latch: number } {
  const b = hexToBytes(netlist);
  const refs: Ref[] = [];
  let nand = 0;
  let latch = 0;
  let i = 0;
  while (i < b.length) {
    const op = b[i];
    if (op === 0x00) {
      if (b.length - i < 7) throw new Error(`netlist truncated at ${i}`);
      nand++;
      i += 7;
    } else if (op === 0x01) {
      if (b.length - i < 4) throw new Error(`netlist truncated at ${i}`);
      latch++;
      i += 4;
    } else if (op === 0x02) {
      if (b.length - i < 31) throw new Error(`netlist truncated at ${i}`);
      const nIns = b[i + 29];
      const len = 31 + 3 * nIns;
      if (b.length - i < len) throw new Error(`netlist truncated at ${i}`);
      const cpu = getAddress(bytesToHex(b.slice(i + 1, i + 21)));
      const id = BigInt(bytesToHex(b.slice(i + 21, i + 29)));
      refs.push({ cpu, id, nIns, nOuts: b[i + 30] });
      i += len;
    } else {
      throw new Error(`bad opcode 0x${op.toString(16)} at ${i}`);
    }
  }
  return { refs, nand, latch };
}
