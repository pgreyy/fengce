import { install } from "../src/lib/data";
import { body, postOnly, respond, type Req, type Res } from "./_util";

/** POST /api/install { safe, pinId, preset, cap?, tokens, spenders, keep?, guard?, recoveryDelay?, recoveryWindow?, adminDelay? } */
export default (req: Req, res: Res) => postOnly(req, res) && respond(res, () => install(body(req)), 0);
