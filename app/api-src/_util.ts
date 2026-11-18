/** Shared helpers for the Vercel API functions (Node runtime with Vercel's request/response helpers). */
export type Req = { method?: string; query: Record<string, string | string[] | undefined>; body?: unknown };
export type Res = { status(code: number): Res; json(v: unknown): void; setHeader(k: string, v: string): void };

export function q(req: Req, k: string): string | undefined {
  const v = req.query[k];
  return Array.isArray(v) ? v[0] : v;
}

export async function respond(res: Res, fn: () => Promise<unknown>, cacheSeconds = 15) {
  res.setHeader("access-control-allow-origin", "*");
  try {
    const out = await fn();
    res.setHeader("cache-control", `s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`);
    res.status(200).json(out);
  } catch (e) {
    const err = e as { shortMessage?: string; details?: string; message?: string };
    res.status(400).json({ error: err.shortMessage ?? (err.message ?? String(e)).split("\n")[0], details: err.details ?? null });
  }
}

export function body(req: Req): any {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body ?? {};
}

export function postOnly(req: Req, res: Res): boolean {
  if (req.method === "POST") return true;
  res.setHeader("allow", "POST");
  res.status(405).json({ error: "POST a JSON body" });
  return false;
}
