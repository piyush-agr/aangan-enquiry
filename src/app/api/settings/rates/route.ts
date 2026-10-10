import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { addRate, COST_UNITS } from "@/lib/costs/service";
import { db } from "@/lib/db/client";

const body = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  category: z.enum(["voice_minute", "telephony_minute"]),
  unit: z.enum(COST_UNITS),
  rate: z.number().positive().max(10_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  source: z.string().min(5, "Say where the rate comes from (e.g. 'VaaniYantra Settings → Billing, Oct 2026')").max(300),
});

export async function POST(req: Request) {
  const u = await apiUser("ADMIN");
  if (isResponse(u)) return u;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  return NextResponse.json({ rate: await addRate(db(), { ...parsed.data, userId: u.id }) });
}
