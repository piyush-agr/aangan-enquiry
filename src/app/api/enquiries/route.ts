import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { listEnquiries, parseListQuery } from "@/lib/enquiries/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  return NextResponse.json(await listEnquiries(parseListQuery(sp)));
}
