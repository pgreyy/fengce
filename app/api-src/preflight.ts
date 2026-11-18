import { preflight } from "../src/lib/data";
import { body, postOnly, respond, type Req, type Res } from "./_util";

/** POST /api/preflight { safe, to, value?, data? }: the Safe's own installed policy on this transaction (not enforcement). */
export default (req: Req, res: Res) => postOnly(req, res) && respond(res, () => preflight(body(req)), 0);
