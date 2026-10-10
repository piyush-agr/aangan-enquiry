import { describe, expect, it } from "vitest";
import { assess, DOCUMENTED_DECLINE_LINE } from "@/lib/qualification/engine";
import { extractFacts, type Turn } from "@/lib/qualification/extract";
import type { Assessment, CriterionId } from "@/lib/qualification/types";
import { scanForPriceLeak } from "@/lib/pricing-guardrails";
import { loadPhoneTranscripts, transcript } from "../fixtures/transcripts";

function run(id: string, extraCaller: string[] = [], callIndex = 0): Assessment {
  const t = transcript(id);
  const turns: Turn[] = [...t.calls[callIndex]!, ...extraCaller.map((text): Turn => ({ role: "CALLER", text }))];
  return assess(extractFacts(turns, { referenceDate: t.date }));
}
const crit = (a: Assessment, id: CriterionId) => a.criteria.find((c) => c.id === id)!;
const say = (lines: string[], ref = new Date("2026-09-15T06:00:00Z")) =>
  assess(extractFacts(lines.map((text): Turn => ({ role: "CALLER", text })), { referenceDate: ref }));

describe("transcript fixtures", () => {
  it("parses all 20 phone records and no WhatsApp/web-form records", () => {
    const all = loadPhoneTranscripts();
    expect(all.map((t) => t.id)).toEqual(Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
    expect(transcript("T08").missed).toBe(true);
    expect(transcript("T08").calls).toHaveLength(0);
    expect(transcript("T17").calls).toHaveLength(2);
  });
});

describe("regression: September phone transcripts (T01–T20)", () => {
  it("T01 qualified full-home 3BHK in Kothrud, budget undisclosed", () => {
    const a = run("T01");
    expect(a.disposition).toBe("QUALIFIED");
    expect(crit(a, "C2_SERVICE_AREA").reason).toMatch(/Kothrud/);
    expect(crit(a, "C4_BUDGET").status).toBe("NOT_APPLICABLE");
    expect(crit(a, "C5_DECISION_MAKER").status).toBe("PASS");
  });

  it("T02 asks for a price twice and still qualifies", () => {
    const a = run("T02");
    expect(a.disposition).toBe("QUALIFIED");
    const f = extractFacts(transcript("T02").calls[0]!, { referenceDate: transcript("T02").date });
    expect(f.pricingQuestions.length).toBeGreaterThanOrEqual(2);
  });

  it("T03 Nashik → declined (outside service area), not forwarded", () => {
    const a = run("T03");
    expect(a.disposition).toBe("NOT_QUALIFIED");
    expect(crit(a, "C2_SERVICE_AREA").status).toBe("FAIL");
    expect(a.closingScript).toMatch(/Pune city and PCMC/);
  });

  it("T04 advice/colour suggestions only → declined", () => {
    const a = run("T04");
    expect(a.disposition).toBe("NOT_QUALIFIED");
    expect(crit(a, "C1_REAL_PROJECT").reasonCode).toBe("ADVICE_ONLY");
  });

  it("T05 large 4BHK in Koregaon Park, realistic timeline → qualified, authority recorded as uncertainty", () => {
    const a = run("T05");
    expect(a.disposition).toBe("QUALIFIED");
    expect(crit(a, "C3_TIMELINE").status).toBe("PASS");
    expect(crit(a, "C5_DECISION_MAKER").status).toBe("UNCLEAR");
    expect(a.uncertainties.join(" ")).toMatch(/authority/i);
  });

  it("T06 800 sq ft office fitout in Baner → qualified commercial", () => {
    const a = run("T06");
    expect(a.disposition).toBe("QUALIFIED");
    expect(a.summary).toMatch(/office/);
  });

  it("T07 'before Diwali' is clarified, and a three-week deadline is declined honestly", () => {
    const t = transcript("T07");
    const first = assess(extractFacts([t.calls[0]![1]!], { referenceDate: t.date }));
    expect(crit(first, "C3_TIMELINE").reasonCode).toBe("TIMELINE_EVENT_UNRESOLVED");
    const answered = assess(
      extractFacts([t.calls[0]![1]!, { role: "AGENT", text: "When would you need the project complete?" }, { role: "CALLER", text: "In about three weeks." }], { referenceDate: t.date }),
    );
    expect(crit(answered, "C3_TIMELINE").status).toBe("FAIL");
    expect(answered.disposition).toBe("NOT_QUALIFIED");
    expect(answered.closingScript).toMatch(/timeline wouldn't work/);
  });

  it("T09 existing-client complaint asking for Nikhil → urgent escalation, no sales qualification", () => {
    const a = run("T09");
    expect(a.disposition).toBe("URGENT_ESCALATION");
    expect(a.priority).toBe("URGENT");
    const f = extractFacts(transcript("T09").calls[0]!, { referenceDate: transcript("T09").date });
    expect(f.callerName?.value).toBe("Sheetal Deshpande");
    expect(f.humanRequested?.value.who).toMatch(/Nikhil/);
    expect(f.complaint?.value.designerName).toBe("Aryan");
  });

  it("T10 volunteered ₹1–1.5 lakh for kitchen + bedroom → budget mismatch addressed, not forwarded, no figures spoken", () => {
    const a = run("T10");
    expect(a.disposition).toBe("NOT_QUALIFIED");
    expect(crit(a, "C4_BUDGET").status).toBe("FAIL");
    expect(a.closingScript).not.toMatch(/\d/);
    expect(scanForPriceLeak(a.closingScript!)).toEqual([]);
  });

  it("T11 rented apartment without structural changes is acceptable; missing timeline is asked, then qualifies", () => {
    const a = run("T11");
    expect(crit(a, "C1_REAL_PROJECT").status).toBe("PASS");
    expect(crit(a, "C1_REAL_PROJECT").reason).toMatch(/rented/);
    expect(a.disposition).toBe("NEEDS_CLARIFICATION");
    expect(a.clarification?.question).toBe("When would you need the project complete?");
    expect(run("T11", ["Ideally by March next year."]).disposition).toBe("QUALIFIED");
  });

  it("T12 5,500 sq ft villa, possession done, March move-in → qualified", () => {
    const a = run("T12");
    expect(a.disposition).toBe("QUALIFIED");
    expect(crit(a, "C3_TIMELINE").status).toBe("PASS");
  });

  it("T13 repeated price requests do not disqualify; the unknown timeline is clarified", () => {
    const a = run("T13");
    expect(a.disposition).toBe("NEEDS_CLARIFICATION");
    expect(a.clarification?.criterion).toBe("C3_TIMELINE");
  });

  it("T14 son enquiring for parents → qualifies with the representation recorded as an uncertainty", () => {
    const a = run("T14", ["They'd like it ready by April."]);
    expect(a.disposition).toBe("QUALIFIED");
    expect(crit(a, "C5_DECISION_MAKER").reasonCode).toBe("RESEARCH_FOR_OTHERS");
    expect(a.uncertainties.join(" ")).toMatch(/on behalf of the owners/);
  });

  it("T15 possession in six weeks, start design now → qualified", () => {
    expect(run("T15").disposition).toBe("QUALIFIED");
  });

  it("T16 frustrated repeat caller → high priority and flagged for careful human handling", () => {
    const a = run("T16");
    expect(a.priority).toBe("HIGH");
    expect(a.reviewFlags.join(" ")).toMatch(/Repeat caller/);
    expect(a.disposition).not.toBe("QUALIFIED"); // scope never captured in the transcript
  });

  it("T17 disconnected first call has nothing to qualify; reconnected call qualifies", () => {
    expect(run("T17", [], 0).disposition).toBe("NEEDS_CLARIFICATION");
    const second = run("T17", [], 1);
    expect(second.disposition).toBe("QUALIFIED");
    expect(crit(second, "C2_SERVICE_AREA").reason).toMatch(/Pimple Saudagar.*PCMC/);
  });

  it("T18 180 sq ft coworking pod → not forwarded; the undocumented minimum routes to human review", () => {
    const a = run("T18");
    expect(a.disposition).not.toBe("QUALIFIED");
    expect(crit(a, "C1_REAL_PROJECT").reviewFlag).toMatch(/not in services\.md/);
    expect(run("T18", ["It's in Baner.", "By December."]).disposition).toBe("HUMAN_REVIEW");
  });

  it("T19 restaurant in Koregaon Park → declined (out of scope)", () => {
    const a = run("T19");
    expect(a.disposition).toBe("NOT_QUALIFIED");
    expect(crit(a, "C1_REAL_PROJECT").reasonCode).toBe("OUT_OF_SCOPE_RESTAURANT");
    expect(a.closingScript).toMatch(/Restaurant/);
  });

  it("T20 Magarpatta 2BHK, flexible January start, owners → qualified", () => {
    expect(run("T20").disposition).toBe("QUALIFIED");
  });
});

describe("rubric rules (qualified.md)", () => {
  it("two or more failures use the documented decline line", () => {
    const a = say(["I want to open a restaurant in Mumbai."]);
    expect(a.failedCount).toBe(2);
    expect(a.closingScript).toBe(DOCUMENTED_DECLINE_LINE);
  });

  it("asks one direct question when the location is unclear", () => {
    const a = say(["We want to redesign our 2BHK completely — kitchen, living room and bedrooms. Done by March."]);
    expect(a.disposition).toBe("NEEDS_CLARIFICATION");
    expect(a.clarification).toEqual({ criterion: "C2_SERVICE_AREA", question: "Which area or city is the property in?" });
  });

  it("asks the rubric's timeline question when the timeline is unclear", () => {
    const a = say(["Full redesign of my 3BHK in Aundh, kitchen and wardrobes."]);
    expect(a.clarification?.question).toBe("When would you need the project complete?");
  });

  it("does not push on budget or authority — undisclosed budget and unknown authority still qualify", () => {
    const a = say(["Complete redesign of a 2BHK in Baner with execution. No rush, sometime next year."]);
    expect(a.disposition).toBe("QUALIFIED");
    expect(a.criteria.find((c) => c.id === "C4_BUDGET")!.status).toBe("NOT_APPLICABLE");
    expect(a.criteria.find((c) => c.id === "C5_DECISION_MAKER")!.status).toBe("UNCLEAR");
  });

  it("an authorised representative qualifies", () => {
    const a = say(["My father has authorised me to go ahead. Full interiors for his 3BHK in Wakad, done by April."]);
    expect(a.criteria.find((c) => c.id === "C5_DECISION_MAKER")!.status).toBe("PASS");
    expect(a.disposition).toBe("QUALIFIED");
  });

  it("a single room with complete redesign and execution qualifies", () => {
    expect(say(["Complete redesign with execution of just our master bedroom in Kothrud, by February."]).disposition).toBe("QUALIFIED");
  });

  it("a volunteered budget that is plausible passes", () => {
    const a = say(["Full home interiors for our 3BHK in Kondhwa, 1,150 sq ft. Budget is 30 lakh. Move in by March."]);
    expect(a.criteria.find((c) => c.id === "C4_BUDGET")!.status).toBe("PASS");
  });

  it("Talegaon 'near Pune' is outside the service area", () => {
    expect(say(["3BHK independent house in Talegaon Dabhade, near Pune. Full interiors, 3–4 months."]).criteria.find((c) => c.id === "C2_SERVICE_AREA")!.status).toBe("FAIL");
  });

  it("an unlisted Pune locality passes with a recorded uncertainty", () => {
    const a = say(["Full redesign of our flat in Kharadi with execution, by March."]);
    const c2 = a.criteria.find((c) => c.id === "C2_SERVICE_AREA")!;
    expect(c2.status).toBe("PASS");
    expect(c2.uncertainty).toMatch(/not named individually/);
  });

  it("structural work routes to human review rather than an automatic decision", () => {
    const a = say(["We want to break the wall between the kitchen and living room and redo the full 2BHK in Baner, by March."]);
    expect(a.disposition).toBe("HUMAN_REVIEW");
  });

  it("commercial space far above ~3,000 sq ft fails criterion 1", () => {
    const a = say(["Office fitout in Hinjewadi, 6,000 sq ft, by January."]);
    expect(a.criteria.find((c) => c.id === "C1_REAL_PROJECT")!.status).toBe("FAIL");
  });

  it("standalone Vastu or furniture sourcing is declined", () => {
    expect(say(["I only want a vastu consultation for my flat in Baner."]).disposition).toBe("NOT_QUALIFIED");
    expect(say(["We just need you to source furniture for our flat in Aundh."]).disposition).toBe("NOT_QUALIFIED");
  });
});

describe("timeline policy boundaries (services.md vs qualified.md kept distinct)", () => {
  const ref = new Date("2026-09-15T06:00:00Z");
  const base = "Full redesign of my 2BHK in Baner with execution.";
  const c3 = (line: string) => say([base, line], ref).criteria.find((c) => c.id === "C3_TIMELINE")!;
  it("< 6 weeks → FAIL (services.md minimum lead time)", () => expect(c3("Need it done in 5 weeks.").status).toBe("FAIL"));
  it("6–11 weeks → human review (documents conflict)", () => {
    const r = c3("Need it ready in 8 weeks.");
    expect(r.status).toBe("UNCLEAR");
    expect(r.reviewFlag).toMatch(/6-week lead-time rule/);
    expect(say([base, "Need it ready in 8 weeks."], ref).disposition).toBe("HUMAN_REVIEW");
  });
  it("11–14 weeks → PASS but recorded as tight", () => {
    const r = c3("We need it done within 12 weeks.");
    expect(r.status).toBe("PASS");
    expect(r.uncertainty).toMatch(/tight/);
  });
  it(">= 14 weeks → PASS", () => expect(c3("Done by March please.").reasonCode).toBe("TIMELINE_REALISTIC"));
  it("possession beyond the 8–10 week window → human review", () => {
    expect(c3("We get possession in about 5 months.").reviewFlag).toMatch(/8–10 week/);
  });
  it("never promises a completion date — reasons describe, they don't commit", () => {
    for (const l of ["Done by March please.", "Need it done in 5 weeks."]) expect(c3(l).reason).not.toMatch(/we will (finish|complete|deliver)/i);
  });
});
