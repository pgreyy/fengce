import { getAddress } from "viem";
import { safeStatus } from "../src/lib/data";
import { q, respond, type Req, type Res } from "./_util";

/** GET /api/safe/:address[?windows=N] (N 100-block windows of event history, default 20, at most 200) */
export default (req: Req, res: Res) =>
  respond(res, () => safeStatus(getAddress(q(req, "address") ?? ""), Math.min(200, Math.max(1, Number(q(req, "windows") ?? 20)))), 10);
