import { catalog } from "../src/lib/data";
import { respond, type Req, type Res } from "./_util";

/** GET /api/catalog */
export default (_req: Req, res: Res) => respond(res, () => catalog(), 30);
