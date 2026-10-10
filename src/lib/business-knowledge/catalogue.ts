/**
 * Source-of-truth layer derived from knowledge/services.md and knowledge/qualified.md.
 *
 * Every entry carries a `source` so an operator can trace it back to the document it came from.
 * tests/unit/knowledge.test.ts parses services.md and fails if any locality, city or exclusion listed
 * there is missing from this catalogue — so the catalogue cannot silently drift from the document.
 */

export type Zone = "PUNE_CITY" | "PCMC" | "OUTSIDE";

export interface Locality {
  name: string;
  zone: Zone;
  aliases?: string[];
  /** `services.md` = explicitly listed; `adjoining-area` = a Pune/PCMC locality not named in the file,
   *  admitted under services.md's "and adjoining areas" wording and flagged for confirmation. */
  source: "services.md" | "adjoining-area";
  parent?: string;
}

const ALIASES: Record<string, string[]> = {
  NIBM: ["NIBM Road"],
  Erandwane: ["Erandwana"],
  Deccan: ["Deccan Gymkhana"],
  "Viman Nagar": ["Vimannagar"],
  "Kalyani Nagar": ["Kalyaninagar"],
};

/** Explicitly listed in services.md → "Service area". */
export const LISTED_LOCALITIES: Locality[] = [
  ...["Kothrud", "Baner", "Aundh", "Wakad", "Koregaon Park", "Kalyani Nagar", "Viman Nagar", "Hadapsar", "Magarpatta", "NIBM", "Kondhwa", "Undri", "Shivane", "Warje", "Erandwane", "Deccan"].map(
    (name): Locality => ({ name, zone: "PUNE_CITY", source: "services.md", aliases: ALIASES[name] }),
  ),
  ...["Pimpri", "Chinchwad", "Pimple Saudagar", "Pimple Nilakh", "Ravet", "Hinjewadi"].map(
    (name): Locality => ({ name, zone: "PCMC", source: "services.md" }),
  ),
];

/**
 * Localities inside Pune city / PCMC limits that services.md does not name individually but covers with
 * "and adjoining areas". A match here PASSES the service-area criterion but is recorded as an
 * uncertainty ("locality not explicitly listed") so a human can correct the list if Nikhil disagrees.
 */
export const ADJOINING_LOCALITIES: Locality[] = [
  ...[
    "Kharadi", "Nanded City", "Bavdhan", "Pashan", "Balewadi", "Shivajinagar", "Camp", "Yerawada", "Wanowrie",
    "Sinhagad Road", "Dhayari", "Katraj", "Bibwewadi", "Swargate", "Sadashiv Peth", "Model Colony", "Prabhat Road",
    "Karve Nagar", "Mundhwa", "Keshav Nagar", "Lohegaon", "Dhanori", "Vishrantwadi", "Wadgaon Sheri", "Fatima Nagar",
    "Salunke Vihar", "Boat Club Road", "Senapati Bapat Road", "Sahakar Nagar", "Parvati",
    "Kasba Peth", "Narhe", "Ambegaon", "Manjri", "Kesnand", "Wagholi", "Hingne",
  ].map((name): Locality => ({ name, zone: "PUNE_CITY", source: "adjoining-area" })),
  ...[
    "Sangvi", "Pimple Gurav", "Akurdi", "Nigdi", "Bhosari", "Moshi", "Tathawade", "Punawale", "Thergaon", "Rahatani",
    "Kalewadi", "Dange Chowk", "Chikhali", "Dapodi", "Kasarwadi", "Pradhikaran",
  ].map((name): Locality => ({ name, zone: "PCMC", source: "adjoining-area" })),
  // Sub-localities seen in the September transcripts, mapped to their listed parent.
  { name: "Dahanukar Colony", zone: "PUNE_CITY", source: "adjoining-area", parent: "Kothrud" },
  { name: "Cybercity", zone: "PUNE_CITY", source: "adjoining-area", parent: "Magarpatta", aliases: ["Cyber City"] },
  { name: "Sunderban", zone: "PUNE_CITY", source: "adjoining-area", parent: "Aundh" },
];

/** Generic names for the whole service area. */
export const AREA_WIDE_NAMES: Locality[] = [
  { name: "Pune", zone: "PUNE_CITY", source: "services.md", aliases: ["Pune city"] },
  { name: "PCMC", zone: "PCMC", source: "services.md", aliases: ["Pimpri-Chinchwad", "Pimpri Chinchwad"] },
];

/** services.md: "We do not currently serve Talegaon, Lonavala, Nashik, Mumbai, or other cities outside this area." */
export const LISTED_EXCLUDED_PLACES = ["Talegaon", "Lonavala", "Nashik", "Mumbai"] as const;

/** Other cities/towns that are unambiguously outside Pune city and PCMC ("or other cities"). */
export const OTHER_OUTSIDE_PLACES = [
  "Thane", "Navi Mumbai", "Satara", "Kolhapur", "Aurangabad", "Sambhajinagar", "Nagpur", "Bangalore", "Bengaluru",
  "Delhi", "Gurgaon", "Gurugram", "Noida", "Hyderabad", "Chennai", "Ahmedabad", "Goa", "Indore", "Lavasa", "Chakan",
  "Baramati", "Shirur", "Khandala", "Panvel", "Alibaug", "Mahabaleshwar", "Solapur", "Sangli", "Kolkata", "Jaipur",
];

export const SERVICE_FACTS = {
  source: "knowledge/services.md",
  residentialTypes: ["apartment", "flat", "independent house", "villa", "bungalow", "row house", "penthouse"],
  commercialInScope: ["office", "clinic", "studio"],
  /** services.md: "Commercial projects: offices, clinics, studios — up to approximately 3,000 sq ft." */
  commercialMaxSqFt: 3000,
  /** Tolerance on "approximately" — above this is a clear fail; between max and this is human review. */
  commercialHardMaxSqFt: 3300,
  outOfScopeTypes: {
    restaurant: ["restaurant", "cafe", "café", "bar", "pub", "eatery", "cloud kitchen"],
    hotel: ["hotel", "resort", "homestay", "guest house", "hostel"],
    retail: ["retail", "shop", "showroom", "boutique", "store"],
    gym: ["gym", "fitness", "crossfit", "yoga studio"],
  },
  timelines: { designWeeks: [3, 4], executionWeeks: [8, 16], minLeadTimeWeeks: 6 },
} as const;

/** A pragmatic minimum seen in front-desk practice (T18: "typically 500 sq ft or more").
 *  NOT stated in services.md — therefore it only ever triggers HUMAN REVIEW, never an automatic decline. */
export const COMMERCIAL_TYPICAL_MIN_SQFT = { value: 500, source: "front-desk practice in transcript T18 — not in services.md; confirm with Nikhil" };

export function allLocalities(): Locality[] {
  return [...LISTED_LOCALITIES, ...ADJOINING_LOCALITIES, ...AREA_WIDE_NAMES];
}
