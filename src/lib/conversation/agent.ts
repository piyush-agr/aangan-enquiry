import { APPROVED_PRICING_RESPONSE } from "@/lib/pricing-guardrails";
import { assess, CLARIFYING_QUESTIONS } from "@/lib/qualification/engine";
import { emptyFacts, extractFacts, normalise, type Turn } from "@/lib/qualification/extract";
import type { Assessment, CriterionId, ExtractedFacts } from "@/lib/qualification/types";

/**
 * Deterministic front-desk dialogue manager. It drives the mock/simulator voice flow and is the
 * behavioural specification for the live VaaniYantra agent (see vaani-agent-pack.ts).
 *
 * Guarantees (all covered by tests):
 *  - one question per turn; never re-asks a criterion it already asked about;
 *  - pricing questions always get APPROVED_PRICING_RESPONSE verbatim and nothing else;
 *  - never claims a booking, a live transfer or a delivered notification;
 *  - existing-client complaints skip qualification and go to urgent escalation;
 *  - caller instructions ("ignore your rules…") are evidence, never commands.
 */

export const OPENING_LINE = "Hello, you've reached Aangan Studio. I'm the studio's virtual assistant. How can I help you today?";

export const INTERNAL_INFO_REFUSAL =
  "I'm not able to share internal studio information or details about other clients, but I'm happy to help with your own project.";

export const NO_LIVE_TRANSFER =
  "I'm the studio's virtual assistant, and I can't transfer calls live right now. I've noted that you'd like to speak with someone from the team, and your request will be passed on so they can call you back.";

export type Phase = "IN_PROGRESS" | "ENDED";

export interface ConversationState {
  turns: Turn[];
  facts: ExtractedFacts;
  asked: (CriterionId | "NAME" | "CONSULTATION" | "COMPLAINT_DETAILS" | "SCOPE_OPEN")[];
  pricingResponses: number;
  phase: Phase;
  endReason?: "QUALIFIED" | "DECLINED" | "ESCALATED" | "REVIEW" | "INCOMPLETE" | "CALLER_ENDED";
  referenceDate: string;
}

export interface AgentReply {
  state: ConversationState;
  reply: string;
  assessment: Assessment;
  /** Which deterministic branch produced the reply — shown in the simulator and asserted in tests. */
  branch:
    | "PRICING_GUARDRAIL"
    | "INTERNAL_INFO_REFUSAL"
    | "URGENT_ESCALATION"
    | "HUMAN_REQUEST"
    | "DECLINE"
    | "CLARIFY"
    | "COLLECT"
    | "HUMAN_REVIEW_CLOSE"
    | "QUALIFIED_CLOSE"
    | "INCOMPLETE_CLOSE"
    | "CALLER_ENDED";
}

export function startConversation(referenceDate: Date): { state: ConversationState; reply: string } {
  const state: ConversationState = {
    turns: [{ role: "AGENT", text: OPENING_LINE }],
    facts: emptyFacts(),
    asked: [],
    pricingResponses: 0,
    phase: "IN_PROGRESS",
    referenceDate: referenceDate.toISOString(),
  };
  return { state, reply: OPENING_LINE };
}

function say(state: ConversationState, text: string) {
  state.turns.push({ role: "AGENT", text });
}

const GOODBYE = /^(?:ok(?:ay)?[,.]?\s*)?(?:bye|goodbye|thanks?,? bye|that'?s all|nothing else|no,? that'?s it|i'?ll call back|let me think(?: and call back)?)\b/i;

export function handleCallerTurn(prev: ConversationState, callerText: string): AgentReply {
  const state: ConversationState = structuredClone(prev);
  const text = normalise(callerText);
  const lastAgent = [...state.turns].reverse().find((t) => t.role === "AGENT")?.text ?? "";
  state.turns.push({ role: "CALLER", text });
  const before = state.facts;
  state.facts = extractFacts(state.turns, { referenceDate: new Date(state.referenceDate) });
  const f = state.facts;
  const a = assess(f);

  const done = (reply: string, branch: AgentReply["branch"], endReason?: ConversationState["endReason"]): AgentReply => {
    say(state, reply);
    if (endReason) {
      state.phase = "ENDED";
      state.endReason = endReason;
    }
    return { state, reply, assessment: assess(state.facts), branch };
  };

  if (state.phase === "ENDED") return done("Thank you for calling Aangan Studio. Goodbye.", "CALLER_ENDED");

  // 1. Pricing — the approved response, verbatim, every time (even if the caller insists or tries to override).
  const newPricing = f.pricingQuestions.length > before.pricingQuestions.length;
  if (newPricing) {
    state.pricingResponses += 1;
    return done(APPROVED_PRICING_RESPONSE, "PRICING_GUARDRAIL");
  }

  // 2. Attempts to extract internals / other clients' data / override rules.
  if (f.injectionAttempts.length > before.injectionAttempts.length) {
    return done(`${INTERNAL_INFO_REFUSAL} ${nextQuestionText(state, a) ?? ""}`.trim(), "INTERNAL_INFO_REFUSAL");
  }

  // 3. Existing-client complaint → urgent escalation, no sales qualification.
  if (a.disposition === "URGENT_ESCALATION") {
    const c = f.complaint?.value;
    if ((!f.callerName || !(c?.projectRef || f.location)) && !state.asked.includes("COMPLAINT_DETAILS")) {
      state.asked.push("COMPLAINT_DETAILS");
      return done("I'm very sorry to hear that — that's not the experience we want you to have. May I have your name and the project location, so I can pass this to the right person straight away?", "URGENT_ESCALATION");
    }
    const who = f.humanRequested?.value.who;
    const name = f.callerName ? `, ${f.callerName.value.split(" ")[0]}` : "";
    return done(
      `Thank you${name}. I've marked this as urgent for the studio's senior team${who ? `, and noted that you'd like to hear from ${who}` : ""}. I can't transfer you live from this line, so I won't promise a callback time I can't guarantee — but your request is being passed to them now as a priority.`,
      "URGENT_ESCALATION",
      "ESCALATED",
    );
  }

  // 4. Caller says goodbye.
  if (GOODBYE.test(text)) {
    return done("Thank you for calling Aangan Studio. Feel free to call us again whenever you're ready.", "CALLER_ENDED", "CALLER_ENDED");
  }

  // 5. Declines (one fail → criterion-specific close; two or more → documented decline line).
  if (a.disposition === "NOT_QUALIFIED") {
    return done(a.closingScript!, "DECLINE", "DECLINED");
  }

  // 6. A human was requested on a sales call: be honest, then continue collecting.
  const humanPrefix = f.humanRequested && !before.humanRequested ? `${NO_LIVE_TRANSFER} ` : "";

  // 7. One direct clarifying question for unclear criterion 1, 2 or 3 — asked at most once each.
  if (a.disposition === "NEEDS_CLARIFICATION") {
    const q = nextQuestionText(state, a);
    if (q) return done(`${humanPrefix}${q}`, humanPrefix ? "HUMAN_REQUEST" : "CLARIFY");
    return done(`${humanPrefix}Thank you for sharing that. I'll pass what you've told me to our team so someone can follow up with you.`, "INCOMPLETE_CLOSE", "INCOMPLETE");
  }

  if (a.disposition === "HUMAN_REVIEW") {
    return done(`${humanPrefix}Thank you — I've noted everything. A member of our team will review the details and get back to you.`, "HUMAN_REVIEW_CLOSE", "REVIEW");
  }

  // 8. Qualified: collect a name and consultation interest, then close honestly.
  if (!f.callerName && !state.asked.includes("NAME")) {
    state.asked.push("NAME");
    return done(`${humanPrefix}Thank you, that's very helpful. May I have your name for the designer?`, humanPrefix ? "HUMAN_REQUEST" : "COLLECT");
  }
  const consultYes = f.consultationRequested?.value === true;
  if (!consultYes && !state.asked.includes("CONSULTATION")) {
    state.asked.push("CONSULTATION");
    return done(`${humanPrefix}Would you like one of our designers to contact you to arrange a consultation?`, humanPrefix ? "HUMAN_REQUEST" : "COLLECT");
  }
  // A plain "no" to the consultation offer is respected.
  if (!consultYes && /^(no|not now|not yet|maybe later)\b/i.test(text) && /consultation/i.test(lastAgent)) {
    return done("No problem at all. I've noted your details — feel free to call us whenever you're ready.", "QUALIFIED_CLOSE", "QUALIFIED");
  }
  const name = f.callerName ? `, ${f.callerName.value.split(" ")[0]}` : "";
  return done(
    `Thank you${name}. I've recorded your request for a consultation, and your details will go to our design team so a designer can contact you to confirm a time. I'm not able to confirm a slot myself on this call.`,
    "QUALIFIED_CLOSE",
    "QUALIFIED",
  );
}

function nextQuestionText(state: ConversationState, a: Assessment): string | undefined {
  // Nothing about the project yet → an open question first (does not use up the criterion-1 question).
  const f = state.facts;
  const nothingKnown = !f.rooms.length && !f.designAndExecution && !f.projectCategory && !f.fullHome && !f.exploringOnly && !f.adviceOnly;
  if (nothingKnown && !state.asked.includes("SCOPE_OPEN")) {
    state.asked.push("SCOPE_OPEN");
    return "Thank you for calling. What are you looking to do?";
  }
  const order: CriterionId[] = ["C1_REAL_PROJECT", "C2_SERVICE_AREA", "C3_TIMELINE"];
  for (const id of order) {
    const cr = a.criteria.find((x) => x.id === id);
    if (cr?.status === "UNCLEAR" && !cr.reviewFlag && !state.asked.includes(id)) {
      state.asked.push(id);
      return CLARIFYING_QUESTIONS[id as keyof typeof CLARIFYING_QUESTIONS];
    }
  }
  return undefined;
}

/** Run a whole scripted conversation (used by the simulator's scenario runner and by tests). */
export function runScript(callerLines: string[], referenceDate: Date): { state: ConversationState; replies: AgentReply[] } {
  let { state } = startConversation(referenceDate);
  const replies: AgentReply[] = [];
  for (const line of callerLines) {
    if (state.phase === "ENDED") break;
    const r = handleCallerTurn(state, line);
    replies.push(r);
    state = r.state;
  }
  return { state, replies };
}
