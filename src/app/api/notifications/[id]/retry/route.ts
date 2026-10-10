import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { retryNotification } from "@/lib/notifications/service";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const r = await retryNotification((await ctx.params).id, { type: "user", id: u.id });
  if ("error" in r) return NextResponse.json(r, { status: r.error === "not found" ? 404 : 409 });
  return NextResponse.json({ notification: r.row });
}
