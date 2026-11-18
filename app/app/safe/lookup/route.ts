import { NextResponse } from "next/server";

export function GET(req: Request) {
  const a = new URL(req.url).searchParams.get("address") ?? "";
  return NextResponse.redirect(new URL(`/safe/${a}`, req.url));
}
