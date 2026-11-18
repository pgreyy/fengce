import { getAddress } from "viem";
import { circuit, plain } from "../src/lib/data";
import { q, respond, type Req, type Res } from "./_util";

/** GET /api/circuit/:processor/:id */
export default (req: Req, res: Res) => respond(res, async () => plain(await circuit(getAddress(q(req, "processor") ?? ""), BigInt(q(req, "id") ?? "0"))), 30);
