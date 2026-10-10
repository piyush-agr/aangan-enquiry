import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allLocalities, LISTED_EXCLUDED_PLACES, LISTED_LOCALITIES } from "@/lib/business-knowledge/catalogue";
import { APPROVED_PRICING_RESPONSE } from "@/lib/pricing-guardrails";
import { CLARIFYING_QUESTIONS, DOCUMENTED_DECLINE_LINE } from "@/lib/qualification/engine";
import { DEFAULT_TIMELINE_POLICY } from "@/lib/qualification/timeline-policy";
import { matchLocation } from "@/lib/qualification/extract";

const K = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../knowledge", f), "utf8");
const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ");

describe("source-of-truth fidelity (catalogue must match services.md / qualified.md / pricing.md)", () => {
  it("contains every locality listed in services.md → Service area", () => {
    const services = K("services.md");
    const section = services.slice(services.indexOf("## Service area"), services.indexOf("We do not currently serve"));
    const listed = [...section.matchAll(/\(([^)]*)\)/g)]
      .flatMap((m) => m[1]!.split(","))
      .map((s) => s.replace(/including/g, "").trim())
      .filter((s) => s && !/adjoining areas/.test(s));
    expect(listed.length).toBeGreaterThanOrEqual(22);
    const names = LISTED_LOCALITIES.map((l) => l.name);
    for (const l of listed) expect(names, `missing locality ${l}`).toContain(l);
    // and every listed locality resolves through the matcher as in-area
    for (const l of listed) expect(matchLocation(`a flat in ${l}`)?.zone).not.toBe("OUTSIDE");
  });

  it("contains every excluded place named in services.md", () => {
    const line = K("services.md").split("\n").find((l) => l.startsWith("We do not currently serve"))!;
    for (const p of ["Talegaon", "Lonavala", "Nashik", "Mumbai"]) {
      expect(line).toContain(p);
      expect(LISTED_EXCLUDED_PLACES).toContain(p);
      expect(matchLocation(`site is in ${p}`)?.zone).toBe("OUTSIDE");
    }
  });

  it("has no duplicate locality names", () => {
    const names = allLocalities().map((l) => l.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses pricing.md's approved response verbatim", () => {
    expect(norm(K("internal/pricing.md"))).toContain(norm(APPROVED_PRICING_RESPONSE));
  });

  it("uses qualified.md's decline line and timeline question verbatim", () => {
    const q = norm(K("qualified.md"));
    expect(q).toContain(norm(DOCUMENTED_DECLINE_LINE));
    expect(q).toContain(CLARIFYING_QUESTIONS.C3_TIMELINE);
  });

  it("keeps the two timeline rules distinct (services.md 6-week lead time vs qualified.md 8–10 week window)", () => {
    expect(K("services.md")).toMatch(/under 6 weeks/);
    expect(K("qualified.md")).toMatch(/8–10 weeks/);
    expect(DEFAULT_TIMELINE_POLICY.minLeadTimeWeeks).toBe(6);
    expect(DEFAULT_TIMELINE_POLICY.siteAvailabilityWindowWeeks).toBe(10);
    expect(DEFAULT_TIMELINE_POLICY.minFeasibleCompletionWeeks).toBe(11); // design 3 + execution 8
  });
});
