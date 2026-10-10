import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { verifyState } from "@/lib/conversation/signing";
import { ingest } from "@/lib/telephony-events/ingest";
import { simulatedCallEvent } from "@/lib/voice-provider/mock";

const body = z.object({
  state: z.unknown().optional(),
  sig: z.string().optional(),
  outcome: z.enum(["COMPLETED", "MISSED", "DISCONNECTED"]).default("COMPLETED"),
  callerPhone: z.string().regex(/^\+?[0-9-]{6,16}$/).optional(),
  simulateProviderFailure: z.boolean().default(false),
  simulateTelegramFailure: z.boolean().default(false),
});

/** Ends a simulated call and pushes it through the real ingestion pipeline as a DEMO record. */
export async function POST(req: Request) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  const d = parsed.data;
  if (d.outcome !== "MISSED" && !verifyState(d.state, d.sig)) return NextResponse.json({ error: "simulator state missing or modified" }, { status: 400 });
  const event = simulatedCallEvent({
    state: d.outcome === "MISSED" ? undefined : (d.state as never),
    outcome: d.outcome,
    callerPhone: d.callerPhone,
    simulateProviderFailure: d.simulateProviderFailure,
  });
  const r = await ingest(event, undefined, { simulateNotificationFailure: d.simulateTelegramFailure });
  return NextResponse.json(r, { status: r.status === "FAILED" ? 500 : 200 });
}
