import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { config } from "@/lib/config/env";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";

export const SESSION_COOKIE = "aangan_session";
export const SESSION_TTL_HOURS = 12;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STAFF";
}

function tokenId(token: string) {
  return createHmac("sha256", config().SESSION_SECRET).update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await db().insert(sessions).values({ id: tokenId(token), userId, expiresAt });
  // opportunistic clean-up of expired sessions
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return { token, expiresAt };
}

export async function userForToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const rows = await db()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenId(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(token: string | undefined | null) {
  if (token) await db().delete(sessions).where(eq(sessions.id, tokenId(token)));
}

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: config().APP_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}
