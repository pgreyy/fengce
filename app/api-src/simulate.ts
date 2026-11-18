import { simulate } from "../src/lib/data";
import { body, postOnly, respond, type Req, type Res } from "./_util";

/** POST /api/simulate { preset, cap?, account?, to, value?, data? } */
export default (req: Req, res: Res) => postOnly(req, res) && respond(res, () => simulate(body(req)), 0);
