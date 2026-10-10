export function istDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function pct(v: number | null): string {
  return v === null ? "N/A" : `${Math.round(v * 1000) / 10}%`;
}
export function inr(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "N/A";
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function secs(v: number | null): string {
  if (v === null) return "N/A";
  if (v < 90) return `${Math.round(v)} s`;
  return `${Math.round((v / 60) * 10) / 10} min`;
}
export const LABEL: Record<string, string> = {
  QUALIFIED: "Qualified",
  NOT_QUALIFIED: "Declined",
  INCOMPLETE: "Incomplete",
  HUMAN_REVIEW: "Needs review",
  URGENT_ESCALATION: "Urgent",
  MISSED: "Missed",
  PENDING: "Pending",
  COMPLETED: "Completed",
  DISCONNECTED: "Disconnected",
  FAILED: "Failed",
  IN_PROGRESS: "In progress",
  SENT: "Sent",
  SIMULATED: "Simulated (demo)",
  UNAVAILABLE: "Telegram not set up",
  NOT_REQUIRED: "Not needed",
  OPEN: "Open",
  RESOLVED: "Resolved",
  NONE: "—",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
  REQUESTED: "Requested (not booked)",
  BOOKED_CONFIRMED: "Booked (confirmed by staff)",
  HELD: "Held",
  NOT_REQUESTED: "Not requested",
  UNKNOWN: "Not yet recorded",
  CONVERTED: "Converted",
  LOST: "Lost",
  ACTUAL: "Actual",
  ESTIMATED: "Estimated",
};
