import {
  allLocalities,
  LISTED_EXCLUDED_PLACES,
  OTHER_OUTSIDE_PLACES,
  SERVICE_FACTS,
} from "@/lib/business-knowledge/catalogue";
import { isPricingQuestion } from "@/lib/pricing-guardrails";
import type { ExtractedFacts, Fact, LocationFact, TimelineFact } from "./types";

/**
 * Deterministic, rule-based extraction of facts from caller speech.
 *
 * Caller statements are treated strictly as EVIDENCE — nothing a caller says is executed as an
 * instruction. Only CALLER turns produce facts; the immediately preceding AGENT turn is used as context
 * to interpret short answers ("Yes", "Sheetal Deshpande.").
 */

export interface Turn {
  role: "AGENT" | "CALLER";
  text: string;
}

export interface ExtractOptions {
  /** The date of the call — relative expressions ("by March", "in three weeks") are resolved against it. */
  referenceDate: Date;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, few: 3,
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";

function num(word: string): number | undefined {
  const w = word.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  return WORD_NUMBERS[w];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+[—–-]\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Straighten typographic quotes/dashes so patterns match speech-to-text and PDF text alike. */
export function normalise(text: string): string {
  return text.replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/** Sentences describing someone else's past project (referral context) must not set this caller's facts. */
const REFERRAL_CONTEXT = /\b(?:done by you|you did (?:her|his|their|my friend)|had (?:her|his|their) (?:flat|home|house|office|place) done|you designed (?:her|his|their))\b/i;

function fact<T>(value: T, evidence: string): Fact<T> {
  return { value, evidence, source: "caller" };
}

function monthIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(t));
}

function endOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

/** Next occurrence of a month at/after the reference month ("by March" said in September → next March). */
function resolveMonth(month: number, ref: Date, explicitYear?: number, nextYear?: boolean): { year: number; month: number } {
  if (explicitYear) return { year: explicitYear, month };
  const refYear = ref.getUTCFullYear();
  let year = month < ref.getUTCMonth() ? refYear + 1 : refYear;
  if (nextYear && year === refYear) year += 1;
  return { year, month };
}

export function weeksBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / (7 * 24 * 3600 * 1000)) * 10) / 10;
}

function toIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------------------------

const LOCALITY_INDEX = (() => {
  const entries: { term: string; loc: LocationFact }[] = [];
  for (const l of allLocalities()) {
    const listedIn: LocationFact["listedIn"] = l.name === "Pune" || l.name === "PCMC" ? "area-wide" : l.source;
    for (const term of [l.name, ...(l.aliases ?? [])]) {
      entries.push({ term, loc: { raw: term, locality: l.parent ? `${l.name} (${l.parent})` : l.name, zone: l.zone, listedIn } });
    }
  }
  for (const p of [...LISTED_EXCLUDED_PLACES, ...OTHER_OUTSIDE_PLACES]) {
    entries.push({ term: p, loc: { raw: p, locality: p, zone: "OUTSIDE", listedIn: "outside-list" } });
  }
  // Longest first so "Pimple Saudagar" beats "Pimpri"/"Pune", "Navi Mumbai" beats "Mumbai".
  return entries.sort((a, b) => b.term.length - a.term.length);
})();

export function matchLocation(text: string): LocationFact | undefined {
  const found: LocationFact[] = [];
  let remaining = text.replace(/aangan studio/gi, "");
  for (const { term, loc } of LOCALITY_INDEX) {
    const re = new RegExp(`\\b${escapeRe(term)}\\b`, "i");
    if (re.test(remaining)) {
      found.push({ ...loc, raw: term });
      remaining = remaining.replace(new RegExp(`\\b${escapeRe(term)}\\b`, "gi"), " ");
    }
  }
  if (!found.length) return undefined;
  // Prefer the most specific in-area locality; an explicit outside place wins over generic "Pune"
  // ("Talegaon, near Pune" is outside).
  const outside = found.find((f) => f.zone === "OUTSIDE");
  const specific = found.find((f) => f.zone !== "OUTSIDE" && f.listedIn !== "area-wide");
  if (outside && !specific) return outside;
  return specific ?? outside ?? found[0];
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

function parseAmount(n: string, unit?: string): number {
  const v = Number(n.replace(/,/g, ""));
  const u = (unit ?? "").toLowerCase();
  if (/^(lakh|lakhs|lac|lacs|l)$/.test(u)) return v * 100_000;
  if (/^(crore|crores|cr)$/.test(u)) return v * 10_000_000;
  if (/^(k|thousand)$/.test(u)) return v * 1_000;
  return v;
}

function extractBudget(s: string): { minInr?: number; maxInr: number; raw: string } | undefined {
  if (!/\bbudget\b|\bcan (?:spend|afford)\b|\bmaximum\b|\bmax\b|\ball-?in\b|\bfor everything\b/i.test(s)) return undefined;
  const range = /(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|crore|crores|cr|k|thousand)?\s*(?:-|–|to)\s*(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|crore|crores|cr|k|thousand)\b/i.exec(s);
  if (range) {
    const unit = range[4];
    return { minInr: parseAmount(range[1]!, range[2] ?? unit), maxInr: parseAmount(range[3]!, unit), raw: range[0] };
  }
  const single = /(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|crore|crores|cr|k|thousand)\b/i.exec(s);
  if (single) return { maxInr: parseAmount(single[1]!, single[2]), raw: single[0] };
  const rupees = /(?:₹|rs\.?\s*)(\d[\d,]{3,})/i.exec(s);
  if (rupees) return { maxInr: parseAmount(rupees[1]!), raw: rupees[0] };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Timeline and site readiness
// ---------------------------------------------------------------------------------------------

const DEADLINE_CUE = /\b(by|before|until|till|done|complete|completed|finish|finished|ready|operational|move (?:back )?in|moving in|deadline|within|maximum|max|arriving|need it)\b/i;
const START_CUE = /\b(start|starting|begin|beginning|commence|kick off)\b/i;
const POSSESSION_CUE = /\b(possession|handover|hand over|handed over|keys)\b/i;

function relativeWeeks(s: string): number | undefined {
  const m = /\b(?:in|within|about|around|roughly|maybe|just|only|next|another)?\s*(\d+(?:\.\d+)?|one|a|an|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple of|few)\s+(week|weeks|month|months)\b/i.exec(s);
  if (!m) {
    if (/\bnext month\b/i.test(s)) return 4.3;
    if (/\bnext week\b/i.test(s)) return 1;
    return undefined;
  }
  const n = num(m[1]!.replace(/ of$/, ""));
  if (n === undefined) return undefined;
  return /month/i.test(m[2]!) ? Math.round(n * 4.35 * 10) / 10 : n;
}

function monthMention(s: string, ref: Date): { date: Date; month: number; year: number } | undefined {
  const m = new RegExp(`\\b${MONTH_RE}\\b(?:\\s+(20\\d\\d))?`, "i").exec(s);
  if (!m) return undefined;
  const idx = monthIndex(m[1]!);
  if (idx < 0) return undefined;
  // "may" is also a verb — require a cue word nearby.
  if (m[1]!.toLowerCase() === "may" && !/\b(by|in|from|before|until|start|of)\s+may\b/i.test(s)) return undefined;
  const explicitYear = m[2] ? Number(m[2]) : undefined;
  const nextYear = /\bnext year\b/i.test(s);
  const { year, month } = resolveMonth(idx, ref, explicitYear, nextYear);
  return { date: endOfMonth(year, month), month, year };
}

function updateTimeline(prev: TimelineFact | undefined, s: string, ref: Date, answeringDeadline = false): TimelineFact | undefined {
  const t: TimelineFact = prev ? { ...prev, raw: [...prev.raw] } : { raw: [] };
  let touched = false;

  if (/\bno rush\b|\bflexible\b|\bno (?:specific )?deadline\b|\bplenty of time\b|\bnot in a (?:rush|hurry)\b|\bwhenever\b|\bno hurry\b/i.test(s)) {
    t.flexible = true;
    touched = true;
  }
  const isPossession = POSSESSION_CUE.test(s);
  const month = monthMention(s, ref);
  const rel = relativeWeeks(s);
  const festival = /\b(diwali|dussehra|ganpati|ganesh chaturthi|navratri|christmas|new year|wedding|holi|eid|the festival)\b/i.exec(s);

  if (!isPossession) {
    if (month && START_CUE.test(s) && !/\b(by|before|until|done|complete|ready|move (?:back )?in|operational)\b/i.test(s)) {
      t.preferredStart = toIsoDate(new Date(Date.UTC(month.year, month.month, 1)));
      touched = true;
    } else if (month && (DEADLINE_CUE.test(s) || /\bmove in\b|\bto move in\b/i.test(s) || !START_CUE.test(s))) {
      t.deadline = toIsoDate(month.date);
      t.deadlineWeeks = weeksBetween(ref, month.date);
      t.unresolvedEvent = undefined;
      touched = true;
    } else if (rel !== undefined && (DEADLINE_CUE.test(s) || answeringDeadline) && !/\b(been|ago|for the last|since)\b/i.test(s)) {
      // "about 4 months" right after "by February" only confirms the month — keep the month deadline.
      if (!(t.deadline && /\babout|around|roughly\b/i.test(s) && !festival)) {
        const d = new Date(ref.getTime() + rel * 7 * 24 * 3600 * 1000);
        t.deadline = toIsoDate(d);
        t.deadlineWeeks = rel;
        t.unresolvedEvent = undefined;
      }
      touched = true;
    } else if (rel !== undefined && /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+weeks?\s+(maximum|max)\b/i.test(s)) {
      t.deadline = toIsoDate(new Date(ref.getTime() + rel * 7 * 24 * 3600 * 1000));
      t.deadlineWeeks = rel;
      touched = true;
    }
    if (festival && /\b(before|by|for|in time for)\b/i.test(s) && !t.deadline) {
      t.unresolvedEvent = festival[1]!;
      touched = true;
    }
    if (/\bafter\s+(diwali|dussehra|ganpati|the festival|christmas|new year)\b/i.test(s) && START_CUE.test(s)) {
      // "What if I start after Diwali?" — replaces an earlier pre-festival deadline with an open start.
      t.unresolvedEvent = undefined;
      t.deadline = undefined;
      t.deadlineWeeks = undefined;
      t.preferredStart = t.preferredStart ?? `after ${festival?.[1] ?? "event"}`;
      touched = true;
    }
    if (/\b(start|begin)\w*\s+(now|right away|immediately|asap|as soon as possible|this month)\b|\bready to start\b|\bwant to start now\b/i.test(s)) {
      t.preferredStart = t.preferredStart ?? toIsoDate(ref);
      touched = true;
    }
  }
  if (touched) t.raw.push(s);
  return touched ? t : prev;
}

function siteFromSentence(s: string, ref: Date): { status: "AVAILABLE" | "POSSESSION_PENDING" | "OCCUPIED" | "BARE_SHELL"; availableInWeeks?: number } | undefined {
  if (POSSESSION_CUE.test(s)) {
    if (/\b(was|got|received|already|have|has been|just got|new)\b.*\b(possession|keys)\b|\bpossession\b.*\b(last month|last week|already|was|in august|done)\b|\bnew possession\b/i.test(s) && !/\b(getting|will get|expect|next month|in about|in \d|in (?:one|two|three|four|five|six|seven|eight))\b/i.test(s)) {
      return { status: "AVAILABLE", availableInWeeks: 0 };
    }
    const rel = relativeWeeks(s);
    const month = monthMention(s, ref);
    if (rel !== undefined) return { status: "POSSESSION_PENDING", availableInWeeks: rel };
    if (month) {
      const w = weeksBetween(ref, new Date(Date.UTC(month.year, month.month, 1)));
      return w <= 0 ? { status: "AVAILABLE", availableInWeeks: 0 } : { status: "POSSESSION_PENDING", availableInWeeks: w };
    }
    return { status: "POSSESSION_PENDING" };
  }
  if (/\bbare shell\b|\bshell and core\b|\bcompletely (?:empty|bare)\b|\bjust columns and floor\b/i.test(s)) return { status: "BARE_SHELL", availableInWeeks: 0 };
  if (/\b(moved out|we(?:'ve| have)? already moved)\b/i.test(s)) return { status: "AVAILABLE", availableInWeeks: 0 };
  if (/\b(we(?:'ve| have)? been here|we live|living there|moved in|i(?:'ve| have) been here)\b/i.test(s)) return { status: "OCCUPIED", availableInWeeks: 0 };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------------------------

const NAME_STOP = new Set([
  "calling", "planning", "looking", "getting", "just", "in", "the", "a", "an", "not", "sure", "from", "interested", "here",
  "doing", "good", "fine", "okay", "ok", "hi", "hello", "yes", "no", "very", "also", "currently", "opening", "trying",
]);

const ROOM_PATTERNS: [string, RegExp][] = [
  ["kitchen", /\bkitchen\b/i],
  ["living room", /\bliving(?: room| area)?\b|\bhall\b/i],
  ["bedroom", /\bbed ?rooms?\b/i],
  ["wardrobes", /\bwardrobes?\b/i],
  ["dining", /\bdining\b/i],
  ["study / home office", /\bstudy\b|\bhome office\b|\bworkspace\b/i],
  ["bathroom", /\bbath(?:room)?s?\b|\btoilets?\b/i],
  ["flooring", /\bflooring\b/i],
  ["workstations", /\bworkstations?\b/i],
  ["cabin", /\bcabins?\b/i],
  ["meeting room", /\bmeeting rooms?\b|\bboardroom\b|\bconference room\b/i],
  ["reception", /\breception\b/i],
  ["break area / pantry", /\bbreak area\b|\bpantry\b|\blounge\b|\bcafeteria\b/i],
  ["pod", /\bpod\b/i],
];

const COUNT_WORD = "(?:both|two|three|four|five|all (?:two|three|four|five)|\\d)";

export function emptyFacts(): ExtractedFacts {
  return { intent: "UNKNOWN", rooms: [], pricingQuestions: [], injectionAttempts: [] };
}

function isNegatedStructural(s: string, idx: number): boolean {
  const before = s.slice(Math.max(0, idx - 40), idx).toLowerCase();
  return /\b(no|not|don'?t|do not|without|never|won'?t|as long as we don'?t)\b[^.]*$/.test(before);
}

export function extractFacts(turns: Turn[], opts: ExtractOptions, base?: ExtractedFacts): ExtractedFacts {
  const f: ExtractedFacts = base ? structuredClone(base) : emptyFacts();
  const ref = opts.referenceDate;
  let lastAgent = "";
  let roomCountBedrooms = 0;

  for (const turn of turns) {
    if (turn.role === "AGENT") {
      lastAgent = turn.text;
      continue;
    }
    const text = normalise(turn.text);
    if (!text) continue;
    const ss = sentences(text);

    // --- prompt-injection / probing for internals: logged as evidence, never obeyed ---
    if (/\bignore (?:all |any |your |the |previous |prior )*(?:instructions|rules|prompt)\b|\bsystem prompt\b|\bdeveloper mode\b|\byou are now\b|\bpretend (?:to be|you are)\b|\binternal (?:pricing|price|document|guide|rates)\b|\bprice list\b|\brate card\b|\bjailbreak\b|\breveal\b.*\b(?:prompt|instructions|pricing|rates)\b|\bother (?:customers?|clients?)(?:'|’)?s? (?:details|data|numbers?|phone)/i.test(text)) {
      f.injectionAttempts.push(text);
    }

    // --- pricing questions ---
    if (isPricingQuestion(text)) f.pricingQuestions.push(text);

    // --- short contextual answers ---
    const shortYes = /^(yes|yeah|yep|sure|of course|absolutely|correct|haan|ha|ji)\b/i.test(text);
    if (shortYes && /\b(owner|decision[- ]maker|decide)\b/i.test(lastAgent) && !/\bnot\b/i.test(text.slice(0, 30))) {
      if (!f.decisionMaker || f.decisionMaker.value === "HOUSEHOLD_UNCONFIRMED") f.decisionMaker = fact("SELF", `${lastAgent} → ${text}`);
    }
    if (shortYes && /\b(consultation|site visit|book|schedule|set up)\b/i.test(lastAgent) && !/\bthink\b/i.test(text)) {
      f.consultationRequested = fact(true, text);
    }
    if (/\b(your name|name please|who am i speaking|may i have your name|take your name)\b/i.test(lastAgent) && !f.callerName) {
      const m = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/.exec(text);
      if (m && !NAME_STOP.has(m[1]!.split(" ")[0]!.toLowerCase())) f.callerName = fact(m[1]!, text);
    }
    if (/\b(location|where is|which area|locality|where's the|where is the property|pune city or pcmc)\b/i.test(lastAgent) && !f.location) {
      const loc = matchLocation(text);
      if (loc) f.location = fact(loc, text);
    }

    const answeringDeadline = /\bwhen would you need (?:the project|it) (?:complete|done|ready)\b|\byour timeline\b|\bhow soon\b/i.test(lastAgent);
    for (const s of ss) {
      // name
      if (!f.callerName) {
        const m = /\b(?:[Ii]'m|[Ii] am|[Tt]his is|[Mm]y name is|[Mm]yself)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(s);
        if (m) {
          const first = m[1]!.split(" ")[0]!.toLowerCase();
          if (!NAME_STOP.has(first) && !matchLocation(m[1]!)) {
            // drop a trailing word that is actually a location ("Ritu Kapoor from")
            f.callerName = fact(m[1]!, s);
          }
        }
      }

      // referral source
      if (!f.referralSource) {
        const r = /\b(got your number from[^.]*|saw your work on \w+|was looking at your work on \w+|referred by [^.,]*|[A-Z][a-z]+ [A-Z][a-z]+ asked me to (?:call|message)|recommend(?:ed|ation)[^.]*|found you on \w+)/i.exec(s);
        if (r) f.referralSource = fact(r[1]!.trim(), s);
      }

      const thirdParty = REFERRAL_CONTEXT.test(s);

      // location
      const loc = thirdParty ? undefined : matchLocation(s);
      if (loc && (!f.location || f.location.value.listedIn === "area-wide" || loc.zone === "OUTSIDE")) {
        if (!(f.location && f.location.value.zone !== "OUTSIDE" && f.location.value.listedIn !== "area-wide" && loc.listedIn === "area-wide")) {
          f.location = fact(loc, s);
        }
      }

      // category / property type
      const lower = s.toLowerCase().replace(/aangan studio/g, "");
      for (const [kind, words] of Object.entries(SERVICE_FACTS.outOfScopeTypes)) {
        const w = (words as readonly string[]).find((x) => new RegExp(`\\b${escapeRe(x)}s?\\b`, "i").test(lower));
        if (w && !/\b(not|isn'?t) (?:a |an )?\b/.test(lower.slice(0, lower.indexOf(w)))) {
          // "gym" inside "gymkhana" is excluded by \b; "Deccan Gymkhana" safe.
          f.outOfScopeService = fact(kind, s);
          f.projectCategory = fact("COMMERCIAL", s);
          f.propertyType = fact(w, s);
        }
      }
      const bhk = thirdParty ? null : /\b(\d)\s*-?\s*bhk\b/i.exec(s);
      if (bhk) {
        f.bhk = fact(Number(bhk[1]), s);
        f.projectCategory = f.projectCategory?.value === "COMMERCIAL" && f.outOfScopeService ? f.projectCategory : fact("RESIDENTIAL", s);
        if (!f.propertyType || /^(home|flat|apartment)$/.test(f.propertyType.value)) f.propertyType = fact(`${bhk[1]}BHK ${/\bindependent house\b/i.test(s) ? "independent house" : "apartment"}`, s);
      }
      const resType = thirdParty ? null : /\b(villa|bungalow|row ?house|independent house|penthouse|apartment|flat)\b/i.exec(s);
      if (resType && !f.outOfScopeService) {
        f.projectCategory = fact("RESIDENTIAL", s);
        const v = resType[1]!.toLowerCase();
        if (!f.propertyType || (v === "villa" || v === "bungalow" || v === "independent house")) f.propertyType = fact(v === "flat" ? (f.bhk ? `${f.bhk.value}BHK apartment` : "apartment") : v, s);
      }
      const com = /\b(office|clinic|coworking|co-working|startup|workstations|commercial)\b/i.exec(s) ?? (/\bstudio\b/i.test(lower) && !/\bagan|aangan\b/i.test(s) ? /\b(studio)\b/i.exec(s) : null);
      if (com && !f.outOfScopeService && !/\bhome office\b/i.test(s)) {
        f.projectCategory = fact("COMMERCIAL", s);
        const t = com[1]!.toLowerCase();
        if (t === "coworking" || t === "co-working") f.propertyType = fact("coworking space", s);
        else if (t === "clinic" || t === "studio") f.propertyType = fact(t, s);
        else if (!f.propertyType || !/coworking|clinic/.test(f.propertyType.value)) f.propertyType = fact("office", s);
      }

      // area
      const area = /(\d[\d,]*)\s*(?:sq\.?\s*(?:ft|feet)|sqft|square\s*(?:feet|foot))/i.exec(s);
      if (area) f.carpetAreaSqFt = fact(Number(area[1]!.replace(/,/g, "")), s);

      // rooms / scope
      for (const [room, re] of ROOM_PATTERNS) {
        if (re.test(s) && !f.rooms.includes(room)) f.rooms.push(room);
      }
      const bedCount = new RegExp(`\\b(${COUNT_WORD})\\s+(?:the\\s+)?bed ?rooms\\b`, "i").exec(s);
      if (bedCount) {
        const w = bedCount[1]!.toLowerCase().replace("all ", "");
        roomCountBedrooms = Math.max(roomCountBedrooms, w === "both" ? 2 : num(w) ?? 2);
      } else if (/\b(?:one|a|the master|master)\s+bed ?room\b/i.test(s)) {
        roomCountBedrooms = Math.max(roomCountBedrooms, 1);
      }
      if (/\bwhole (?:thing|home|house|flat)\b|\bfull home\b|\bentire (?:flat|home|house|apartment)\b|\bfull (?:redesign|package|interiors?|end-to-end|home)\b|\bcomplete redesign\b|\bpoora ghar\b|\ball of it\b|\bfull end[- ]to[- ]end\b|\bend[- ]to[- ]end\b/i.test(s)) {
        f.fullHome = fact(true, s);
      }

      // design + execution vs advice
      const advice = /\b(?:just|only)\s+(?:want\s+|looking for\s+|need\s+)?(?:some\s+)?(?:ideas|suggestions|advice|tips|a consultation)\b|\bgive (?:us|me) (?:some )?(?:ideas|suggestions|advice)\b|\bcome and (?:advise|give (?:us|me) (?:some )?ideas)\b|\bsuggestions on colou?rs\b|\bfurniture arrangement\b|\brearrang\w* (?:the )?furniture\b|\bi(?:'ll| will) do the execution (?:myself|ourselves)\b|\b(?:consultation|advice|advisory) only\b|\bsecond opinion\b|\bnot planning to do the full thing\b|\bstyling only\b|\bjust (?:the )?design(?:s)?,? (?:no|not the|without) execution\b/i.exec(s);
      if (advice) {
        f.adviceOnly = fact(true, s);
        f.designAndExecution = fact(false, s);
      }
      if (/\bjust exploring\b|\bjust looking\b|\bearly stage\b|\bstill exploring\b|\bonly exploring\b/i.test(s)) f.exploringOnly = fact(true, s);
      if (/\b(?:only|just)\b.*\b(?:source|buy|procure)\b.*\bfurniture\b|\bfurniture sourcing\b/i.test(s) && !/\bdesign\b/i.test(s)) {
        f.outOfScopeService = fact("furniture-sourcing-only", s);
      }
      if (/\bvastu\b/i.test(s) && /\b(only|just|consult\w*|advice|advisory|check)\b/i.test(s) && !/\b(redesign|design and|execution|interiors)\b/i.test(s)) {
        f.outOfScopeService = fact("vastu-only", s);
      }
      if (/\b(?:need|want|looking for) an architect\b|\bbuilding plan\b|\bconstruct(?:ion)? of (?:a|my|the) (?:house|bungalow|building)\b|\bbuild (?:a|my) (?:house|bungalow)\b|\bstructural (?:design|engineer)\b/i.test(s)) {
        f.architectureOnly = fact(true, s);
      }
      if (!advice && /\b(redo|re-do|redesign|renovat\w*|fit-?out|interiors?|interior project|interior design|properly design|proper design|end[- ]to[- ]end|full execution|design and execution|design, materials|modular kitchen|wardrobes|workstations|make (?:it|the \w+) look|full redesign|complete redesign|want (?:a|the) (?:proper )?design|start the design|design karwana)\b/i.test(s) || /\b(?:want|like|need|planning) to do (?:the|my|our|a)\s+(?:kitchen|living|bed ?room|flat|home|house|office|interiors?)/i.test(s)) {
        if (!f.adviceOnly) f.designAndExecution = fact(true, s);
      }

      // structural
      const st = /\b(?:break|breaking|knock\w*|mov(?:e|ing)|remov(?:e|ing)|demolish\w*)\s+(?:down\s+)?(?:a\s+|the\s+|any\s+)?walls?\b|\bwall-breaking\b|\bstructural\b|\badd(?:ing)? (?:a|another) (?:floor|storey)\b|\bextension\b/i.exec(s);
      if (st) f.structuralWork = fact(!isNegatedStructural(s, st.index), s);

      // rented
      if (/\brent(?:ed|al)?\b|\blease\b|\btenant\b|\blandlord\b/i.test(s)) f.rented = fact(true, s);

      // timeline + site
      f.timeline = (() => {
        const t = updateTimeline(f.timeline?.value, s, ref, answeringDeadline);
        return t ? fact(t, f.timeline && t === f.timeline.value ? f.timeline.evidence : s) : f.timeline;
      })();
      const site = siteFromSentence(s, ref);
      if (site) f.site = fact({ ...site, raw: s }, s);

      // decision-maker
      const dmSelf = /\b(?:i am|i'm) the (?:owner|founder|co-?founder|decision[- ]maker|director|ceo|md|proprietor|managing partner)\b|\bmyself and my (?:husband|wife|partner)\b|\bmy (?:husband|wife|partner) and (?:i|me)\b|\bwe (?:both )?own\b|\b(?:he|she|they) (?:knows? we(?:'re| are) calling and is happy|said to go ahead|is happy to go ahead|are happy to go ahead)\b|\bi(?:'m| am) the one deciding\b/i.test(s);
      const dmAuth = /\b(?:authori[sz]ed me|have authori[sz]ed|has authori[sz]ed|asked me to (?:go ahead|move forward|proceed|handle (?:it|this|the project)|book))\b|\bon behalf of\b.*\b(?:authori[sz]ed|go ahead)\b|\bi(?:'m| am) handling (?:it|this|the project) for\b/i.test(s);
      const dmResearch = /\b(?:initial (?:checking|research)|just (?:doing (?:some |the )?)?(?:research|checking)|they(?:'ll| will) decide|(?:parents|in-laws|father|mother|boss) (?:will|would) decide|calling to see if it(?:'s| is) worth)\b/i.test(s);
      const dmHousehold = /\b(?:we have|i have|our|my)\s+(?:a\s+)?(?:\d\s*bhk|flat|apartment|home|house|villa|office|place|property)\b|\bwe(?:'ve| have) just bought\b/i.test(s);
      if (dmSelf) f.decisionMaker = fact("SELF", s);
      else if (dmAuth && f.decisionMaker?.value !== "SELF") f.decisionMaker = fact("AUTHORISED_REPRESENTATIVE", s);
      else if (dmResearch && !["SELF", "AUTHORISED_REPRESENTATIVE"].includes(f.decisionMaker?.value ?? "")) f.decisionMaker = fact("RESEARCH_FOR_OTHERS", s);
      else if (dmHousehold && !f.decisionMaker) f.decisionMaker = fact("HOUSEHOLD_UNCONFIRMED", s);

      // budget (only ever recorded when volunteered)
      const b = extractBudget(s);
      if (b) f.budget = fact(b, s);

      // existing-client complaint
      const existing = /\bmy (?:current |ongoing )?project (?:has been|is|was)\b|\bmy designer\b|\bour designer\b|\bongoing project\b|\bexisting (?:client|project)\b|\bsite work (?:has|is)\b|\byour team (?:has|is|hasn'?t)\b/i.test(s);
      const grievance = /\bhasn'?t (?:replied|responded|called|come)\b|\bnot (?:replied|responded|acceptable)\b|\bno (?:reply|response|update)\b|\bcomplain\w*\b|\bunacceptable\b|\bdelay(?:ed)?\b|\bnobody (?:is )?(?:responding|replying)\b|\bunhappy\b|\bdisappointed\b/i.test(s);
      if (existing && (grievance || /\bnot acceptable\b/i.test(text))) {
        const designer = /\b[Mm]y designer (?:is |was )?([A-Z][a-z]+)/.exec(text);
        const ref2 = /\b(?:[Ff]lat|[Pp]roject|[Ss]ite|[Aa]partment) in ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(text);
        f.complaint = fact({ designerName: designer?.[1], projectRef: ref2?.[1] }, s);
        f.intent = "EXISTING_PROJECT_ISSUE";
      } else if (f.complaint) {
        // follow-up details for an already-raised complaint
        const designer = /\b[Mm]y designer is ([A-Z][a-z]+)/.exec(s)?.[1];
        const where = /\b(?:[Ff]lat|[Pp]roject|[Ss]ite|[Aa]partment) in ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(s)?.[1];
        if (designer || where) f.complaint = fact({ designerName: designer ?? f.complaint.value.designerName, projectRef: where ?? f.complaint.value.projectRef }, f.complaint.evidence);
      }
      if (/\bnot acceptable\b|\bunacceptable\b|\bnot a good sign\b|\bfrustrat\w*\b|\bannoyed\b|\bridiculous\b/i.test(s)) f.frustrated = fact(true, s);

      // human / senior escalation request
      const human = /\b(?:speak|talk)\s+(?:to|with)\s+(someone|a (?:real )?(?:person|human)|a senior(?: person)?|someone senior|the manager|a manager|the owner|nikhil|the founder|your boss)\b|\breal person\b|\bhuman being\b|\b(?:want|need) (?:it|a call(?:back)?) from (nikhil[^.]*|a senior[^.]*)/i.exec(s);
      if (human) f.humanRequested = fact({ who: human[1] ?? human[2] }, s);
      if (/\b(?:from|speak to|call from) nikhil\b|\bsenior person\b/i.test(s) && f.humanRequested) {
        f.humanRequested = fact({ who: /nikhil or a senior person/i.test(s) ? "Nikhil or a senior person" : f.humanRequested.value.who }, f.humanRequested.evidence);
      }

      // previous enquiry not followed up (a new-project lead, not an existing client)
      if (/\b(?:i(?:'d| had)? called|i messaged|i enquired|i contacted|i rang)\b.*\b(?:on \w+day|last week|days ago|before|earlier|yesterday)\b|\bsomeone said they(?:'d| would) get back\b|\bno one (?:called|replied|got back)\b|\bnever (?:heard|got a call) back\b/i.test(s)) {
        f.previousEnquiryLost = fact(true, s);
      }

      // consultation
      if (/\b(?:let'?s|please|can you|i(?:'d| would) like to|want to|shall we)\s+(?:book|schedule|set up|arrange)\b|\bbook (?:it|a consultation|the consultation)\b|\byes,? (?:please )?book\b|\bsite visit\b.*\byes\b|\byes please\b.*\bsite visit\b|\bready to book\b/i.test(s)) {
        f.consultationRequested = fact(true, s);
      }
      const cb = /\b(?:weekdays? (?:after|before) \d+\s*(?:am|pm)|weekends?(?: only)?|(?:any |every )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: morning| evening| afternoon)?|after \d+\s*(?:am|pm)|(?:in the )?(?:morning|evening|afternoon)s?)\b/i.exec(s);
      if (cb && /\b(call|callback|available|works|free|prefer|best time|reach)\b/i.test(s)) f.preferredCallbackTime = fact(cb[0], s);
    }
  }

  if (roomCountBedrooms > 0 && f.rooms.includes("bedroom")) {
    f.rooms = f.rooms.map((r) => (r === "bedroom" ? (roomCountBedrooms > 1 ? `bedrooms ×${roomCountBedrooms}` : "bedroom") : r));
  }
  if (f.intent === "UNKNOWN" && (f.designAndExecution || f.projectCategory || f.location || f.rooms.length)) f.intent = "NEW_PROJECT";
  return f;
}

/** Room count used for budget-floor reasoning (bedrooms ×N counted individually). */
export function countRooms(f: ExtractedFacts): number {
  let n = 0;
  for (const r of f.rooms) {
    const m = /×(\d+)/.exec(r);
    if (m) n += Number(m[1]);
    else if (!["wardrobes", "flooring"].includes(r)) n += 1;
  }
  return n;
}
