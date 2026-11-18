import { getAddress } from "viem";
import { safeStatus } from "../src/lib/data";
import type { Snapshot } from "../src/lib/events";
import snapshot from "../public/events-snapshot.json";
import { q, respond, type Req, type Res } from "./_util";

/** GET /api/safe/:address: configuration plus Fengce events (build snapshot and a live scan of newer blocks). */
export default (req: Req, res: Res) => respond(res, () => safeStatus(getAddress(q(req, "address") ?? ""), snapshot as unknown as Snapshot), 10);
