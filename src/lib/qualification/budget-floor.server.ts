import "server-only";
import type { ExtractedFacts } from "./types";
import { countRooms } from "./extract";

/**
 * SERVER-ONLY. Criterion 4 asks us to catch a *volunteered* budget that is "clearly below what any
 * project of their described scope would cost". Judging "clearly below" needs a floor, which is derived
 * from the lowest figures in knowledge/internal/pricing.md.
 *
 * These figures are NEVER spoken, returned by an API, written to a handoff, or shipped to the browser
 * (`server-only` makes a client import fail the build; scripts/check-bundle-leaks.ts double-checks the
 * built bundle). The voice agent's pricing answer is the fixed approved response and does not use them.
 */
const FLOORS = {
  singleRoomAllInMin: 350_000, // "Single room redesign (all-in): from the lowest end of the range"
  residentialPerSqFtMin: 1_800, // lowest residential band
  commercialPerSqFtMin: 1_200, // lowest commercial band
};

/** A volunteered budget below this fraction of the floor is "clearly below" → criterion 4 FAIL. */
export const CLEARLY_BELOW_FRACTION = 0.5;

export interface FloorEstimate {
  floorInr: number;
  basis: "area-residential" | "area-commercial" | "room-count";
}

export function scopeFloor(f: ExtractedFacts): FloorEstimate | undefined {
  const area = f.carpetAreaSqFt?.value;
  const cat = f.projectCategory?.value;
  const rooms = countRooms(f);
  if (cat === "COMMERCIAL") {
    return area ? { floorInr: area * FLOORS.commercialPerSqFtMin, basis: "area-commercial" } : undefined;
  }
  // Partial scope: count the rooms actually described.
  if (rooms > 0 && !f.fullHome?.value) {
    return { floorInr: rooms * FLOORS.singleRoomAllInMin, basis: "room-count" };
  }
  if (area && cat === "RESIDENTIAL") return { floorInr: area * FLOORS.residentialPerSqFtMin, basis: "area-residential" };
  if (rooms > 0) return { floorInr: rooms * FLOORS.singleRoomAllInMin, basis: "room-count" };
  return undefined;
}
