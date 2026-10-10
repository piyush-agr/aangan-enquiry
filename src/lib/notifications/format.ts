import type { Enquiry } from "@/lib/db/schema";
import { scanForPriceLeak } from "@/lib/pricing-guardrails";

/**
 * Telegram message bodies. Plain text (no parse_mode) so caller-supplied text can never inject markup.
 * Never includes: internal price data, full transcripts, the volunteered budget, tokens or secrets.
 */

export function enquiryRef(e: Pick<Enquiry, "seq">): string {
  return `AAN-${String(e.seq).padStart(5, "0")}`;
}

function ist(d?: Date | null): string {
  if (!d) return "not recorded";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
}

const line = (label: string, v?: string | number | null) => `${label}: ${v === undefined || v === null || v === "" ? "not provided" : v}`;

function clean(s: string): string {
  // strip control chars, cap length
  return s.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, 3500);
}

export interface FormatOptions {
  baseUrl?: string;
  uncertainties?: string[];
  demo?: boolean;
}

function link(e: Enquiry, baseUrl?: string) {
  return baseUrl ? [`Open (login required): ${baseUrl.replace(/\/$/, "")}/enquiries/${e.id}`] : [];
}

export function qualifiedHandoff(e: Enquiry, o: FormatOptions = {}): string {
  const body = [
    ...(o.demo ? ["🧪 DEMO — SIMULATED CALL, NOT A REAL ENQUIRY", ""] : []),
    "AANGAN STUDIO — NEW QUALIFIED ENQUIRY",
    line("Enquiry ID", enquiryRef(e)),
    line("Received at", ist(e.callArrivedAt)),
    line("Caller", e.callerName),
    line("Phone", e.callerPhone ? `${e.callerPhone}${e.callerPhoneVerified ? "" : " (unverified)"}` : null),
    line("Project", e.projectCategory?.toLowerCase()),
    line("Property", e.propertyType),
    line("Location", e.locality),
    line("Scope", e.scopeSummary),
    line("Approximate carpet area", e.carpetAreaSqFt ? `${e.carpetAreaSqFt} sq ft` : null),
    line("Timeline", e.timelineSummary),
    line("Site readiness", e.siteReadiness),
    line("Decision-maker status", e.decisionMakerStatus),
    line("Qualification", "QUALIFIED — meets Nikhil's five criteria"),
    line("Uncertainties", o.uncertainties?.length ? o.uncertainties.map((u) => `• ${u}`).join("\n") : "none recorded"),
    line("Caller request", e.consultationStatus === "REQUESTED" ? "Consultation requested — NOT yet booked; please call to confirm a time" : "Follow-up call"),
    ...(e.preferredCallbackTime ? [line("Preferred callback time", e.preferredCallbackTime)] : []),
    ...(e.referralSource ? [line("Referral", e.referralSource)] : []),
    "Source: Incoming phone call",
    ...link(e, o.baseUrl),
  ];
  return clean(body.join("\n"));
}

export function urgentEscalation(e: Enquiry, o: FormatOptions = {}): string {
  const body = [
    ...(o.demo ? ["🧪 DEMO — SIMULATED CALL, NOT A REAL ENQUIRY", ""] : []),
    "🔴 AANGAN STUDIO — URGENT: EXISTING CLIENT ESCALATION",
    line("Enquiry ID", enquiryRef(e)),
    line("Received at", ist(e.callArrivedAt)),
    line("Caller", e.callerName),
    line("Phone", e.callerPhone),
    line("Project / location", e.locality),
    line("Issue", e.summary),
    line("Requested", e.escalationRecipient ?? "a senior person"),
    "The caller was told the request is being passed on as a priority. No callback time was promised.",
    "Source: Incoming phone call",
    ...link(e, o.baseUrl),
  ];
  return clean(body.join("\n"));
}

export function missedCall(e: Enquiry, o: FormatOptions = {}): string {
  const body = [
    ...(o.demo ? ["🧪 DEMO — SIMULATED CALL, NOT A REAL ENQUIRY", ""] : []),
    "AANGAN STUDIO — MISSED CALL (manual follow-up)",
    line("Enquiry ID", enquiryRef(e)),
    line("Time", ist(e.callArrivedAt)),
    line("Phone", e.callerPhone),
    "No conversation took place. Automatic callbacks are not enabled — please call back manually.",
    ...link(e, o.baseUrl),
  ];
  return clean(body.join("\n"));
}

/** Last line of defence: refuse to send a message that looks like it contains a price. */
export function assertNoPriceLeak(text: string): void {
  const leaks = scanForPriceLeak(text);
  if (leaks.length) throw new Error(`notification blocked by pricing guardrail (${leaks.map((l) => l.code).join(",")})`);
}
