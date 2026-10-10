/**
 * Pricing guardrail — knowledge/internal/pricing.md says no number, range or per-sq-ft figure may be
 * quoted to a client, and gives exactly one acceptable response. This module:
 *   1. detects pricing questions in caller speech (deterministic, no model involved);
 *   2. returns the approved response verbatim — it never reads the internal price table;
 *   3. scans any agent-side text (transcripts, handoff notes, API payloads) for price leaks.
 *
 * Nothing in this file contains a price figure, so importing it anywhere (even client code) leaks nothing.
 */

export const APPROVED_PRICING_RESPONSE =
  "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

export const PRICING_POLICY_VERSION = "pricing-guardrail/2026-10-01";

const PRICING_QUESTION_PATTERNS: RegExp[] = [
  /\bhow much\b/i,
  /\bwhat (?:would|will|does|might) (?:it|this|that|something like that) cost\b/i,
  /\b(?:cost|costs|costing)\b(?!\s+(?:me|us)\s+(?:my|our)\s+(?:job|time))/i,
  /\bpric(?:e|es|ing)\b/i,
  /\brates?\b(?!\s*of\s+(?:progress|speed))/i,
  /\bper\s*(?:sq\.?|square)\s*(?:ft|feet|foot)\b/i,
  /\bper\s*sqft\b/i,
  /\bballpark\b/i,
  /\b(?:rough|approximate|indicative|price)\s+(?:range|figure|number|estimate|idea)\b/i,
  /\beven a range\b/i,
  /\bquot(?:e|ation)\b/i,
  /\bestimate\b/i,
  /\bcharges?\b/i,
  /\bfees?\b/i,
  /\bkitna\b/i,
  /\bkharcha\b/i,
  /\brate card\b/i,
];

/** Statements that mention money but are budget *disclosures*, not price questions. */
const BUDGET_DISCLOSURE = /\b(?:my|our)\s+budget\b|\bbudget\s+(?:is|of)\b|\bcan (?:spend|afford)\b/i;

export function isPricingQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const hit = PRICING_QUESTION_PATTERNS.some((re) => re.test(t));
  if (!hit) return false;
  // "My budget is 1 to 1.5 lakh. Is that possible?" → budget disclosure, handled by criterion 4.
  if (BUDGET_DISCLOSURE.test(t) && !/\bhow much\b|\bper\s*(?:sq|square)|\bballpark\b|\brates?\b|\bpric/i.test(t)) return false;
  // "not even for a smaller fee?" (T18) is a question about taking the job, still treat as pricing → safe.
  return true;
}

/**
 * Patterns that indicate a figure is being given to a client. Applied to agent/handoff text only.
 * Area echoes ("about 1,400 sq ft carpet") are allowed; money and rate language next to a number is not.
 */
const LEAK_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "CURRENCY_SYMBOL_WITH_NUMBER", re: /(?:₹|\brs\.?|\binr)\s*\d/i },
  { code: "NUMBER_WITH_MONEY_UNIT", re: /\d[\d,.]*\s*(?:-|–|to)?\s*\d*[\d,.]*\s*(?:lakh|lakhs|lac|lacs|crore|crores|k\b|thousand|rupees)/i },
  { code: "PER_SQFT_RATE", re: /\d[\d,.]*\s*(?:rupees\s*)?(?:per|\/|a)\s*(?:sq\.?\s*(?:ft|feet)|square\s*(?:foot|feet)|sqft)/i },
  { code: "RATE_PHRASE", re: /\b(?:it(?:'|’)?ll cost around|it will cost around|our rates start|rates start at|typically costs?|for a \d\s*bhk it(?:'|’)?s typically|starting (?:from|at) (?:₹|rs))/i },
  { code: "PRICE_TIER_LEAK", re: /\b(?:standard|premium|luxury|basic|mid-range)\s+specification\b|\bbasic fitout\b|\bmid-range office\b/i },
];

export interface LeakFinding {
  code: string;
  excerpt: string;
}

export function scanForPriceLeak(text: string): LeakFinding[] {
  const findings: LeakFinding[] = [];
  for (const { code, re } of LEAK_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 30);
      findings.push({ code, excerpt: text.slice(start, m.index + m[0].length + 30) });
    }
  }
  return findings;
}

/** Scan a whole transcript; only agent turns are audited (callers may of course say numbers). */
export function auditTranscript(turns: { role: string; text: string }[]): LeakFinding[] {
  return turns
    .filter((t) => t.role.toUpperCase() === "AGENT")
    .flatMap((t) => scanForPriceLeak(t.text));
}

/**
 * Remove price-looking fragments before text is stored in a place designers or the API will see
 * (e.g. a provider summary written by the provider's LLM). The caller's own budget is stored
 * separately as a structured field, so nothing needed is lost.
 */
export function redactPriceFigures(text: string): string {
  let out = text;
  for (const { re } of LEAK_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "[price redacted]");
  }
  return out;
}
