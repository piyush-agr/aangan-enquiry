import { NextResponse } from "next/server";
import { overview, parsePeriod } from "@/lib/analytics/queries";
import { apiUser, isResponse } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  return NextResponse.json(await overview(parsePeriod(Object.fromEntries(new URL(req.url).searchParams.entries()))));
}
