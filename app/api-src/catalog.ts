import { catalog } from "../src/lib/data";
import type { Snapshot } from "../src/lib/events";
import snapshot from "../public/events-snapshot.json";
import { respond, type Req, type Res } from "./_util";

/** GET /api/catalog: listings with gas, tiers and installs (build snapshot plus newer blocks). */
export default (_req: Req, res: Res) => respond(res, () => catalog(snapshot as unknown as Snapshot), 30);
