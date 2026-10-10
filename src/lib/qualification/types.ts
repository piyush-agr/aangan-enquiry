export const RULE_VERSION = "qualified.md/2026-09 · engine 1.0.0";

export interface Fact<T> {
  value: T;
  /** The caller statement (or provider field) this fact was taken from. */
  evidence: string;
  source: "caller" | "provider-collected-data" | "call-metadata" | "operator";
}

export type ProjectCategory = "RESIDENTIAL" | "COMMERCIAL";
export type DecisionMaker = "SELF" | "AUTHORISED_REPRESENTATIVE" | "RESEARCH_FOR_OTHERS" | "HOUSEHOLD_UNCONFIRMED";

export interface LocationFact {
  raw: string;
  locality?: string;
  zone: "PUNE_CITY" | "PCMC" | "OUTSIDE";
  listedIn: "services.md" | "adjoining-area" | "outside-list" | "area-wide";
}

export interface TimelineFact {
  /** Date by which the caller needs the project complete (ISO date), if stated. */
  deadline?: string;
  deadlineWeeks?: number;
  /** Preferred start (ISO date), if stated. */
  preferredStart?: string;
  flexible?: boolean;
  /** Mentioned a festival/event without a resolvable date (e.g. "before Diwali"). */
  unresolvedEvent?: string;
  raw: string[];
}

export interface SiteFact {
  status: "AVAILABLE" | "POSSESSION_PENDING" | "OCCUPIED" | "BARE_SHELL";
  availableInWeeks?: number;
  raw: string;
}

export interface ExtractedFacts {
  intent: "NEW_PROJECT" | "EXISTING_PROJECT_ISSUE" | "UNKNOWN";
  callerName?: Fact<string>;
  projectCategory?: Fact<ProjectCategory>;
  propertyType?: Fact<string>;
  bhk?: Fact<number>;
  location?: Fact<LocationFact>;
  carpetAreaSqFt?: Fact<number>;
  rooms: string[];
  fullHome?: Fact<boolean>;
  /** true → caller wants design + execution; false → advice / self-execution only. */
  designAndExecution?: Fact<boolean>;
  adviceOnly?: Fact<boolean>;
  exploringOnly?: Fact<boolean>;
  outOfScopeService?: Fact<string>;
  structuralWork?: Fact<boolean>;
  architectureOnly?: Fact<boolean>;
  rented?: Fact<boolean>;
  timeline?: Fact<TimelineFact>;
  site?: Fact<SiteFact>;
  decisionMaker?: Fact<DecisionMaker>;
  budget?: Fact<{ minInr?: number; maxInr: number; raw: string }>;
  pricingQuestions: string[];
  complaint?: Fact<{ designerName?: string; projectRef?: string }>;
  humanRequested?: Fact<{ who?: string }>;
  consultationRequested?: Fact<boolean>;
  preferredCallbackTime?: Fact<string>;
  referralSource?: Fact<string>;
  previousEnquiryLost?: Fact<boolean>;
  frustrated?: Fact<boolean>;
  injectionAttempts: string[];
}

export type CriterionId = "C1_REAL_PROJECT" | "C2_SERVICE_AREA" | "C3_TIMELINE" | "C4_BUDGET" | "C5_DECISION_MAKER";
export type CriterionStatus = "PASS" | "FAIL" | "UNCLEAR" | "NOT_APPLICABLE";

export interface CriterionResult {
  id: CriterionId;
  label: string;
  status: CriterionStatus;
  reason: string;
  reasonCode: string;
  evidence: string[];
  /** Set when the supplied documents do not clearly resolve the case — routes to human review. */
  reviewFlag?: string;
  /** Recorded uncertainty for the handoff note (criteria 4 and 5 and admitted edge cases). */
  uncertainty?: string;
}

export type Disposition =
  | "QUALIFIED"
  | "NOT_QUALIFIED"
  | "NEEDS_CLARIFICATION"
  | "HUMAN_REVIEW"
  | "URGENT_ESCALATION";

export interface Assessment {
  ruleVersion: string;
  disposition: Disposition;
  criteria: CriterionResult[];
  failedCount: number;
  reasonCodes: string[];
  uncertainties: string[];
  reviewFlags: string[];
  /** One direct question, only when criterion 1, 2 or 3 is unclear. */
  clarification?: { criterion: CriterionId; question: string };
  /** What the agent should say to close the call when the enquiry is declined. */
  closingScript?: string;
  priority: "NORMAL" | "HIGH" | "URGENT";
  summary: string;
}
