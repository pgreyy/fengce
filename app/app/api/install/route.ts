import { NextResponse } from "next/server";
import { install } from "@/lib/data";

export const dynamic = "force-dynamic";

/** POST { safe, guard?, pinId, preset, cap?, tokens, spenders, keep?, delays? } -> preflight + Safe Transaction Builder JSON. */
export async function POST(req: Request) {
  try {
    return NextResponse.json(await install(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
