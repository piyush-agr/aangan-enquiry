import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { addActualCost } from "@/lib/costs/service";
import { db } from "@/lib/db/client";

const body = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  amount: z.number().nonnegative().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("INR"),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().min(3).max(200),
});

/** Record an actual invoiced amount (e.g. VaaniYantra monthly invoice, hosting bill). */
export async function POST(req: Request) {
  const u = await apiUser("ADMIN");
  if (isResponse(u)) return u;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const d = parsed.data;
  const row = await addActualCost(db(), { provider: d.provider, amount: d.amount, currency: d.currency, periodEnd: new Date(`${d.periodEnd}T23:59:59+05:30`), note: d.note, userId: u.id });
  return NextResponse.json({ cost: row });
}
