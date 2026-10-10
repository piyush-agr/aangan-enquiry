import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import { callEvents, costRecords, enquiries } from "@/lib/db/schema";

/** Deletes DEMO records only (is_demo = true). Production records are never touched. */
export async function POST(req: Request) {
  const u = await apiUser("ADMIN");
  if (isResponse(u)) return u;
  const b = await req.json().catch(() => ({}));
  if (b?.confirm !== "DELETE DEMO DATA") return NextResponse.json({ error: "confirmation text required" }, { status: 400 });
  const r = await db().transaction(async (tx) => {
    await tx.delete(costRecords).where(eq(costRecords.isDemo, true));
    await tx.delete(callEvents).where(eq(callEvents.isDemo, true));
    const del = await tx.delete(enquiries).where(eq(enquiries.isDemo, true)).returning({ id: enquiries.id });
    await audit(tx, { type: "user", id: u.id }, "data.purged", "enquiry", null, { demoRecords: del.length });
    return del.length;
  });
  return NextResponse.json({ deleted: r });
}
