import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./session";

/** For server components/pages: redirects to /login when there is no valid session. */
export async function requireUser(role?: "ADMIN"): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userForToken(token);
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/?forbidden=1");
  return user;
}

/** For API routes: returns the user, or a 401/403 response. */
export async function apiUser(role?: "ADMIN"): Promise<SessionUser | NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userForToken(token);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (role && user.role !== role) return NextResponse.json({ error: "forbidden", requiredRole: role }, { status: 403 });
  return user;
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
