import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "@/lib/config/env";
import { reprocessPending } from "@/lib/telephony-events/ingest";
import { VaaniYantraAdapter } from "@/lib/voice-provider/vaaniyantra";

export const dynamic = "force-dynamic";

function authorised(req: Request) {
  const secret = config().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Re-processes events left PENDING/FAILED. Called by Vercel Cron (GET with Bearer CRON_SECRET). */
async function handle(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const adapter = new VaaniYantraAdapter(config());
  const results = await reprocessPending(config().VOICE_PROVIDER === "vaaniyantra" ? (e) => adapter.enrich(e) : undefined);
  return NextResponse.json({ examined: results.length, processed: results.filter((r) => r.status === "PROCESSED").length, results });
}
export const GET = handle;
export const POST = handle;
