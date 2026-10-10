import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUser, isResponse } from "@/lib/auth/guard";
import { handleCallerTurn, startConversation } from "@/lib/conversation/agent";
import { signState, verifyState } from "@/lib/conversation/signing";

const body = z.object({ text: z.string().max(2000).optional(), state: z.unknown().optional(), sig: z.string().optional() });

/** One simulator turn. Runs the same deterministic agent + rule engine used for real-call analysis. */
export async function POST(req: Request) {
  const u = await apiUser();
  if (isResponse(u)) return u;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid input" }, { status: 400 });
  if (!parsed.data.state) {
    const { state, reply } = startConversation(new Date());
    return NextResponse.json({ state, sig: signState(state), reply, branch: "OPENING" });
  }
  if (!verifyState(parsed.data.state, parsed.data.sig)) return NextResponse.json({ error: "simulator state was modified" }, { status: 400 });
  if (!parsed.data.text?.trim()) return NextResponse.json({ error: "say something" }, { status: 400 });
  const r = handleCallerTurn(parsed.data.state, parsed.data.text);
  return NextResponse.json({ state: r.state, sig: signState(r.state), reply: r.reply, branch: r.branch, assessment: r.assessment, facts: r.state.facts });
}
