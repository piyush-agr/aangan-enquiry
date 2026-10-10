import { COMMERCIAL_TYPICAL_MIN_SQFT, SERVICE_FACTS } from "@/lib/business-knowledge/catalogue";
import { CLEARLY_BELOW_FRACTION, scopeFloor } from "./budget-floor.server";
import { DEFAULT_TIMELINE_POLICY, type TimelinePolicy } from "./timeline-policy";
import { RULE_VERSION, type Assessment, type CriterionResult, type Disposition, type ExtractedFacts } from "./types";

/**
 * Nikhil's five-criterion rubric (knowledge/qualified.md) as explicit, testable logic.
 * The language model (if any) never decides qualification — this function does.
 */

export const DOCUMENTED_DECLINE_LINE =
  "This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes.";

export const CLARIFYING_QUESTIONS = {
  C1_REAL_PROJECT: "Are you looking for a complete design-and-execution project, or mainly advice and ideas?",
  C2_SERVICE_AREA: "Which area or city is the property in?",
  C3_TIMELINE: "When would you need the project complete?", // verbatim from qualified.md
} as const;

const OUT_OF_SCOPE_LABEL: Record<string, string> = {
  restaurant: "Restaurant and hospitality interiors",
  hotel: "Hotel and hospitality interiors",
  retail: "Retail store interiors",
  gym: "Gym and fitness-space interiors",
  "furniture-sourcing-only": "Standalone furniture sourcing",
  "vastu-only": "Standalone Vastu consultation",
};

function c(
  id: CriterionResult["id"],
  label: string,
  status: CriterionResult["status"],
  reasonCode: string,
  reason: string,
  evidence: (string | undefined)[],
  extra: Partial<CriterionResult> = {},
): CriterionResult {
  return { id, label, status, reasonCode, reason, evidence: evidence.filter((e): e is string => Boolean(e)), ...extra };
}

function criterion1(f: ExtractedFacts): CriterionResult {
  const L = "Real project — design and execution, not advice alone";
  if (f.outOfScopeService) {
    const kind = f.outOfScopeService.value;
    return c("C1_REAL_PROJECT", L, "FAIL", `OUT_OF_SCOPE_${kind.toUpperCase().replace(/-/g, "_")}`, `${OUT_OF_SCOPE_LABEL[kind] ?? kind} are outside the studio's services (services.md → What we don't do).`, [f.outOfScopeService.evidence]);
  }
  if (f.architectureOnly?.value) {
    return c("C1_REAL_PROJECT", L, "FAIL", "OUT_OF_SCOPE_ARCHITECTURE", "Architecture/structural work is outside the studio's scope (services.md).", [f.architectureOnly.evidence]);
  }
  if (f.adviceOnly?.value) {
    return c("C1_REAL_PROJECT", L, "FAIL", "ADVICE_ONLY", "Caller wants advice/ideas only; minimum engagement is a room redesign with full execution.", [f.adviceOnly.evidence]);
  }
  const area = f.carpetAreaSqFt?.value;
  if (f.projectCategory?.value === "COMMERCIAL" && area !== undefined) {
    if (area > SERVICE_FACTS.commercialHardMaxSqFt) {
      return c("C1_REAL_PROJECT", L, "FAIL", "COMMERCIAL_ABOVE_SCOPE", `Commercial space of ${area} sq ft exceeds the ~${SERVICE_FACTS.commercialMaxSqFt} sq ft commercial limit (services.md).`, [f.carpetAreaSqFt?.evidence]);
    }
    if (area > SERVICE_FACTS.commercialMaxSqFt) {
      return c("C1_REAL_PROJECT", L, "UNCLEAR", "COMMERCIAL_NEAR_LIMIT", `Commercial space of ${area} sq ft is just above the "approximately ${SERVICE_FACTS.commercialMaxSqFt} sq ft" limit.`, [f.carpetAreaSqFt?.evidence], { reviewFlag: "Commercial area slightly above the ~3,000 sq ft guideline — human decision needed." });
    }
    if (area < COMMERCIAL_TYPICAL_MIN_SQFT.value) {
      return c("C1_REAL_PROJECT", L, "UNCLEAR", "COMMERCIAL_BELOW_TYPICAL", `Commercial space of ${area} sq ft is below the ${COMMERCIAL_TYPICAL_MIN_SQFT.value} sq ft front-desk norm. services.md states no minimum, so this is not an automatic decline.`, [f.carpetAreaSqFt?.evidence], { reviewFlag: `Small commercial space (${area} sq ft) — ${COMMERCIAL_TYPICAL_MIN_SQFT.source}.` });
    }
  }
  if (f.structuralWork?.value) {
    return c("C1_REAL_PROJECT", L, "UNCLEAR", "STRUCTURAL_REQUESTED", "Caller mentioned structural changes, which the studio does not do; the remaining interior scope may still fit.", [f.structuralWork.evidence], { reviewFlag: "Structural work requested — designer must confirm which part of the scope Aangan can take." });
  }
  if (f.designAndExecution?.value || (f.fullHome?.value && !f.exploringOnly?.value)) {
    const notes: string[] = [];
    if (f.rented?.value) notes.push("rented property, no structural changes requested — acceptable per qualified.md");
    return c("C1_REAL_PROJECT", L, "PASS", "DESIGN_AND_EXECUTION", `Caller wants a design-and-execution project${f.rooms.length ? ` (${f.rooms.join(", ")})` : ""}.${notes.length ? " Note: " + notes.join("; ") + "." : ""}`, [f.designAndExecution?.evidence ?? f.fullHome?.evidence]);
  }
  if (f.exploringOnly?.value) {
    return c("C1_REAL_PROJECT", L, "UNCLEAR", "EXPLORING_ONLY", "Caller says they are only exploring — real-project intent not established.", [f.exploringOnly.evidence]);
  }
  return c("C1_REAL_PROJECT", L, "UNCLEAR", "SCOPE_UNKNOWN", "The scope of work has not been described yet.", []);
}

function criterion2(f: ExtractedFacts): CriterionResult {
  const L = "In service area — Pune city or PCMC";
  const loc = f.location?.value;
  if (!loc) return c("C2_SERVICE_AREA", L, "UNCLEAR", "LOCATION_UNKNOWN", "Property location not stated.", []);
  if (loc.zone === "OUTSIDE") {
    return c("C2_SERVICE_AREA", L, "FAIL", "OUTSIDE_SERVICE_AREA", `${loc.locality} is outside Pune city and PCMC (services.md → Service area).`, [f.location?.evidence]);
  }
  const zone = loc.zone === "PCMC" ? "PCMC" : "Pune city";
  if (loc.listedIn === "services.md") {
    return c("C2_SERVICE_AREA", L, "PASS", "LISTED_LOCALITY", `${loc.locality} (${zone}) is listed in services.md.`, [f.location?.evidence]);
  }
  if (loc.listedIn === "adjoining-area") {
    return c("C2_SERVICE_AREA", L, "PASS", "ADJOINING_LOCALITY", `${loc.locality} is a ${zone} locality covered by "and adjoining areas" in services.md.`, [f.location?.evidence], { uncertainty: `Locality "${loc.locality}" is not named individually in services.md — classified as ${zone}.` });
  }
  return c("C2_SERVICE_AREA", L, "PASS", "AREA_WIDE_ONLY", `Caller said "${loc.raw}" without a specific locality.`, [f.location?.evidence], { uncertainty: "Exact locality not given — confirm it is inside Pune city / PCMC." });
}

function criterion3(f: ExtractedFacts, p: TimelinePolicy): CriterionResult {
  const L = "Realistic timeline";
  const t = f.timeline?.value;
  const site = f.site?.value;
  const ev = [...(t?.raw ?? []), site?.raw];

  if (site?.status === "POSSESSION_PENDING" && site.availableInWeeks !== undefined && site.availableInWeeks > p.siteAvailabilityWindowWeeks) {
    return c("C3_TIMELINE", L, "UNCLEAR", "SITE_OUTSIDE_WINDOW", `Site available in ~${site.availableInWeeks} weeks — beyond the ${p.siteAvailabilityWindowWeeks}-week window in qualified.md.`, ev, { reviewFlag: "Site availability beyond the 8–10 week planning window — decide whether to engage now or later." });
  }
  if (t?.deadlineWeeks !== undefined) {
    const w = t.deadlineWeeks;
    if (w < p.minLeadTimeWeeks) {
      return c("C3_TIMELINE", L, "FAIL", "TIMELINE_UNDER_MIN_LEAD", `Needs completion in ~${w} weeks; services.md: execution cannot begin for a project needed in under ${p.minLeadTimeWeeks} weeks.`, ev);
    }
    if (w < p.minFeasibleCompletionWeeks) {
      return c("C3_TIMELINE", L, "UNCLEAR", "TIMELINE_POLICY_CONFLICT", `Needs completion in ~${w} weeks: above the ${p.minLeadTimeWeeks}-week minimum lead time, but below the ${p.minFeasibleCompletionWeeks} weeks implied by design (3–4) + execution (8–16).`, ev, { reviewFlag: "Tight deadline the documents don't resolve (6-week lead-time rule vs. 3+8 week phase durations) — a designer should judge feasibility." });
    }
    const tight = w < p.comfortableCompletionWeeks;
    return c("C3_TIMELINE", L, "PASS", tight ? "TIMELINE_TIGHT_FEASIBLE" : "TIMELINE_REALISTIC", `Completion wanted by ${t.deadline} (~${w} weeks).`, ev, tight ? { uncertainty: `Deadline is ~${w} weeks away — feasible on paper but tight; confirm at consultation.` } : {});
  }
  if (t?.unresolvedEvent) {
    return c("C3_TIMELINE", L, "UNCLEAR", "TIMELINE_EVENT_UNRESOLVED", `Caller mentioned "${t.unresolvedEvent}" but no date — completion date unclear.`, ev);
  }
  if (t?.flexible || t?.preferredStart) {
    return c("C3_TIMELINE", L, "PASS", t.flexible ? "TIMELINE_FLEXIBLE" : "TIMELINE_START_ONLY", t.flexible ? "Caller is flexible on timing." : `Caller wants to start ${/^\d{4}-/.test(t.preferredStart ?? "") ? `from ${t.preferredStart}` : t.preferredStart}; no completion deadline given.`, ev, t.flexible ? {} : { uncertainty: "No completion date stated — confirm expectations at consultation." });
  }
  if (site && site.status === "POSSESSION_PENDING" && site.availableInWeeks !== undefined) {
    return c("C3_TIMELINE", L, "PASS", "SITE_WITHIN_WINDOW", `Site available in ~${site.availableInWeeks} weeks; no completion deadline given.`, ev, { uncertainty: "No completion date stated." });
  }
  return c("C3_TIMELINE", L, "UNCLEAR", "TIMELINE_UNKNOWN", "Completion timeline not stated.", ev);
}

function criterion4(f: ExtractedFacts): CriterionResult {
  const L = "Budget broadly suitable (only if volunteered)";
  const b = f.budget?.value;
  if (!b) return c("C4_BUDGET", L, "NOT_APPLICABLE", "BUDGET_NOT_DISCLOSED", "Budget not volunteered — not probed (qualified.md: treat as qualified).", []);
  const floor = scopeFloor(f);
  if (!floor) {
    return c("C4_BUDGET", L, "UNCLEAR", "BUDGET_SCOPE_UNKNOWN", "Caller volunteered a budget but the scope is not clear enough to judge it.", [f.budget?.evidence], { uncertainty: "Caller volunteered a budget; fit to be confirmed by the designer." });
  }
  if (b.maxInr < floor.floorInr * CLEARLY_BELOW_FRACTION) {
    return c("C4_BUDGET", L, "FAIL", "BUDGET_CLEARLY_BELOW_SCOPE", "Volunteered budget is clearly below what the described scope would cost with full execution.", [f.budget?.evidence]);
  }
  if (b.maxInr < floor.floorInr) {
    return c("C4_BUDGET", L, "UNCLEAR", "BUDGET_POSSIBLY_TIGHT", "Volunteered budget may be tight for the described scope — not clearly insufficient.", [f.budget?.evidence], { uncertainty: "Volunteered budget may be tight for the scope — designer to discuss." });
  }
  return c("C4_BUDGET", L, "PASS", "BUDGET_PLAUSIBLE", "Volunteered budget is not obviously misaligned with the scope.", [f.budget?.evidence]);
}

function criterion5(f: ExtractedFacts): CriterionResult {
  const L = "Decision-maker on the call (or authorised)";
  const d = f.decisionMaker;
  switch (d?.value) {
    case "SELF":
      return c("C5_DECISION_MAKER", L, "PASS", "DECISION_MAKER_SELF", "Caller is the owner/decision-maker (or co-owner with consent).", [d.evidence]);
    case "AUTHORISED_REPRESENTATIVE":
      return c("C5_DECISION_MAKER", L, "PASS", "AUTHORISED_REPRESENTATIVE", "Caller says they are authorised to act for the decision-maker.", [d.evidence]);
    case "RESEARCH_FOR_OTHERS":
      return c("C5_DECISION_MAKER", L, "UNCLEAR", "RESEARCH_FOR_OTHERS", "Caller is enquiring for others who will decide.", [d.evidence], { uncertainty: "Caller is enquiring on behalf of the owners, who will decide — confirm the owners will attend the consultation." });
    case "HOUSEHOLD_UNCONFIRMED":
      return c("C5_DECISION_MAKER", L, "UNCLEAR", "AUTHORITY_UNCONFIRMED", "Caller refers to the property as theirs but did not confirm decision authority.", [d.evidence], { uncertainty: "Decision-making authority not explicitly confirmed (not pushed, per rubric)." });
    default:
      return c("C5_DECISION_MAKER", L, "UNCLEAR", "AUTHORITY_UNKNOWN", "Decision-maker status not discussed.", [], { uncertainty: "Decision-maker status not established (not pushed, per rubric)." });
  }
}

const SINGLE_FAIL_SCRIPTS: Record<string, (f: ExtractedFacts) => string> = {
  C1_REAL_PROJECT: (f) => {
    const kind = f.outOfScopeService?.value;
    if (kind && OUT_OF_SCOPE_LABEL[kind]) {
      const label = OUT_OF_SCOPE_LABEL[kind]!;
      return kind.endsWith("only")
        ? `Thank you for asking. ${label} isn't something we offer — we take on complete design-and-execution projects, and include those requirements within them. If you plan a full redesign, we'd be glad to help.`
        : `Thank you for thinking of us. ${label} are outside our scope — we focus on homes, offices, clinics and studios. I'm sorry we can't help with this one.`;
    }
    if (f.architectureOnly?.value) return "Thank you for calling. We're interior designers rather than architects, so structural and building work isn't something we take on. I'm sorry we can't help with this one.";
    if (f.projectCategory?.value === "COMMERCIAL" && (f.carpetAreaSqFt?.value ?? 0) > SERVICE_FACTS.commercialHardMaxSqFt) return "Thank you for considering us. Our commercial work is for offices, clinics and studios up to about 3,000 square feet, so a space of this size is beyond what we take on. I'm sorry we can't help this time.";
    return "Thank you for thinking of us. Our projects always include design and full execution together — we don't offer advice-only or styling visits. If you decide to go ahead with a complete redesign, we'd be glad to help.";
  },
  C2_SERVICE_AREA: (f) =>
    `Thank you for calling. We currently work only in Pune city and PCMC — our contractors need to be on site, and we don't have that network in ${f.location?.value.locality ?? "that area"}. I'm sorry we can't help this time.`,
  C3_TIMELINE: () =>
    "Thank you for explaining. To be honest, that timeline wouldn't work for us — the design phase alone takes three to four weeks, and execution follows, so we couldn't do justice to the project in that time. If your timeline changes, we'd be glad to hear from you.",
  C4_BUDGET: () =>
    "I appreciate you sharing that. For the scope you've described, with full design and execution, that budget would be significantly below what a project like this involves with us. I wouldn't want to bring you to a consultation if the numbers don't align — a local contractor working at that price point may be a better fit.",
};

export interface AssessOptions {
  policy?: TimelinePolicy;
}

export function assess(f: ExtractedFacts, opts: AssessOptions = {}): Assessment {
  const policy = opts.policy ?? DEFAULT_TIMELINE_POLICY;
  const criteria = [criterion1(f), criterion2(f), criterion3(f, policy), criterion4(f), criterion5(f)];
  const fails = criteria.filter((x) => x.status === "FAIL");
  const uncertainties = criteria.map((x) => x.uncertainty).filter((x): x is string => Boolean(x));
  const reviewFlags = criteria.map((x) => x.reviewFlag).filter((x): x is string => Boolean(x));

  let priority: Assessment["priority"] = "NORMAL";
  if (f.previousEnquiryLost?.value) {
    priority = "HIGH";
    reviewFlags.push("Repeat caller — an earlier enquiry was not followed up. Handle with care.");
  }
  if (f.humanRequested) priority = priority === "NORMAL" ? "HIGH" : priority;
  if (f.frustrated?.value && priority === "NORMAL") priority = "HIGH";
  if (f.injectionAttempts.length) uncertainties.push("Caller attempted to obtain internal information or override the agent's rules — ignored.");

  let disposition: Disposition;
  let clarification: Assessment["clarification"];
  let closingScript: string | undefined;

  if (f.intent === "EXISTING_PROJECT_ISSUE" || f.complaint) {
    // Existing-client complaints bypass sales qualification entirely.
    disposition = "URGENT_ESCALATION";
    priority = "URGENT";
  } else if (fails.length >= 2) {
    disposition = "NOT_QUALIFIED";
    closingScript = DOCUMENTED_DECLINE_LINE;
  } else if (fails.length === 1) {
    disposition = "NOT_QUALIFIED";
    closingScript = SINGLE_FAIL_SCRIPTS[fails[0]!.id]?.(f) ?? DOCUMENTED_DECLINE_LINE;
  } else {
    const askable = criteria.find((x) => ["C1_REAL_PROJECT", "C2_SERVICE_AREA", "C3_TIMELINE"].includes(x.id) && x.status === "UNCLEAR" && !x.reviewFlag);
    if (askable) {
      disposition = "NEEDS_CLARIFICATION";
      clarification = { criterion: askable.id, question: CLARIFYING_QUESTIONS[askable.id as keyof typeof CLARIFYING_QUESTIONS] };
    } else if (reviewFlags.length) {
      disposition = "HUMAN_REVIEW";
    } else {
      disposition = "QUALIFIED";
    }
  }

  const reasonCodes = criteria.map((x) => `${x.id}:${x.status}:${x.reasonCode}`);
  const summary = summarise(f, disposition, fails.map((x) => x.reason));
  return { ruleVersion: RULE_VERSION, disposition, criteria, failedCount: fails.length, reasonCodes, uncertainties, reviewFlags, clarification, closingScript, priority, summary };
}

function summarise(f: ExtractedFacts, d: Disposition, failReasons: string[]): string {
  if (d === "URGENT_ESCALATION") {
    const c0 = f.complaint?.value;
    return `Existing-client issue${c0?.projectRef ? ` (${c0.projectRef})` : ""}${c0?.designerName ? `, designer ${c0.designerName}` : ""}${f.humanRequested?.value.who ? ` — wants ${f.humanRequested.value.who}` : ""}.`;
  }
  const parts = [
    f.propertyType?.value ?? f.projectCategory?.value?.toLowerCase(),
    f.location?.value.locality ? `in ${f.location.value.locality}` : undefined,
    f.carpetAreaSqFt ? `~${f.carpetAreaSqFt.value} sq ft` : undefined,
    f.rooms.length ? `scope: ${f.rooms.join(", ")}` : f.fullHome?.value ? "scope: full home" : undefined,
  ].filter(Boolean);
  const head = parts.length ? parts.join(", ") : "Enquiry";
  if (d === "NOT_QUALIFIED") return `${head}. Declined — ${failReasons.join(" ")}`;
  return `${head}.`;
}
