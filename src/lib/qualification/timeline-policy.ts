import { SERVICE_FACTS } from "@/lib/business-knowledge/catalogue";

/**
 * The two documents state timeline rules differently, so they are kept as separate, named parameters
 * instead of being collapsed into one invented rule:
 *
 *  - services.md  → "we cannot begin execution on a project that needs to be ready in under 6 weeks"
 *                   (minLeadTimeWeeks — a hard floor: below it, decline honestly).
 *  - services.md  → design 3–4 weeks + execution 8–16 weeks. The fastest documented path to completion is
 *                   therefore 3 + 8 = 11 weeks (minFeasibleCompletionWeeks).
 *  - qualified.md → "the site must be available for execution within 8–10 weeks of the consultation"
 *                   (siteAvailabilityWindowWeeks = 10, the outer bound).
 *
 * A deadline between 6 and 11 weeks passes the services.md floor but contradicts the documented phase
 * durations. The documents do not resolve that case, so it goes to HUMAN REVIEW (never auto-declined,
 * never auto-forwarded). Nothing in this policy ever promises a completion date to a caller.
 */
export interface TimelinePolicy {
  minLeadTimeWeeks: number;
  minFeasibleCompletionWeeks: number;
  comfortableCompletionWeeks: number;
  siteAvailabilityWindowWeeks: number;
}

export const DEFAULT_TIMELINE_POLICY: TimelinePolicy = {
  minLeadTimeWeeks: SERVICE_FACTS.timelines.minLeadTimeWeeks,
  minFeasibleCompletionWeeks: SERVICE_FACTS.timelines.designWeeks[0] + SERVICE_FACTS.timelines.executionWeeks[0],
  comfortableCompletionWeeks: SERVICE_FACTS.timelines.designWeeks[1] + 10,
  siteAvailabilityWindowWeeks: 10,
};
