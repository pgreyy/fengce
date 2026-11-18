import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { circuit, plain } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ processor: string; id: string }> }) {
  const { processor, id } = await ctx.params;
  try {
    return NextResponse.json(plain(await circuit(getAddress(processor), BigInt(id))));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
