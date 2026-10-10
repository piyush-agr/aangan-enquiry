import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";
import { cookieOptions, createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";

const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const rl = rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const [u] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  const ok = u ? await verifyPassword(parsed.data.password, u.passwordHash) : false;
  if (!u || !ok) {
    await audit(db(), { type: "system" }, "auth.login_failed", "user", null, { ip: clientIp(req) });
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  const { token, expiresAt } = await createSession(u.id);
  await audit(db(), { type: "user", id: u.id }, "auth.login", "user", u.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  return res;
}
