import { NextResponse } from "next/server";
import { simulate } from "@/lib/data";

export const dynamic = "force-dynamic";

/** POST { preset, cap?, account?, to, value?, data? } -> facts, circuit input bits, decision (eth_call only). */
export async function POST(req: Request) {
  try {
    return NextResponse.json(await simulate(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
