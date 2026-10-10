import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: pages without a session cookie go to /login. Real validation happens server-side per request. */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("aangan_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!login|api|_next|favicon.ico).*)"] };
