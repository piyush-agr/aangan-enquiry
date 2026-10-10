import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { getEnquiryDetail, updateEnquiry, updateSchema } from "@/lib/enquiries/service";
import { dispatchNotification } from "@/lib/notifications/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const d = await getEnquiryDetail((await ctx.params).id);
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Transcripts are restricted to admins over the API.
  if (u.role !== "ADMIN") d.enquiry.transcript = null;
  return NextResponse.json(d);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  const id = (await ctx.params).id;
  const after = await updateEnquiry(id, parsed.data, { type: "user", id: u.id });
  if (!after) return NextResponse.json({ error: "not found" }, { status: 404 });
  // A manual change to QUALIFIED/URGENT (e.g. after human review) triggers the corresponding handoff once.
  if (parsed.data.disposition === "QUALIFIED" || parsed.data.disposition === "URGENT_ESCALATION") await dispatchNotification(id, { actor: { type: "user", id: u.id } });
  return NextResponse.json({ enquiry: after });
}
