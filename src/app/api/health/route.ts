import { NextResponse } from "next/server";
import { healthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await healthReport();
  return NextResponse.json(r, { status: r.database === "ok" ? 200 : 503 });
}
