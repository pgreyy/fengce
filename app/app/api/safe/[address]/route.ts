import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { safeStatus } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  try {
    return NextResponse.json(await safeStatus(getAddress(address)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
