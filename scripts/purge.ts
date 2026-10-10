import "./load-env";
import { and, isNotNull, lt } from "drizzle-orm";
import { audit, SYSTEM } from "../src/lib/audit";
import { config } from "../src/lib/config/env";
import { closeDb, db } from "../src/lib/db/client";
import { callEvents, enquiries } from "../src/lib/db/schema";

/**
 * Retention: removes transcripts, provider summaries and raw provider payloads older than
 * DATA_RETENTION_DAYS (default 365). Structured enquiry fields and metrics are kept.
 * Usage: npm run data:purge            (dry run)
 *        npm run data:purge -- --apply
 */
async function main() {
  const days = config().DATA_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000);
  const apply = process.argv.includes("--apply");
  const where = and(lt(enquiries.callArrivedAt, cutoff), isNotNull(enquiries.transcript));
  const n = (await db().select({ id: enquiries.id }).from(enquiries).where(where)).length;
  console.log(`${n} enquiries older than ${days} days still hold a transcript (cutoff ${cutoff.toISOString()}).`);
  if (!apply) return console.log("Dry run. Re-run with --apply to purge.");
  await db().transaction(async (tx) => {
    await tx.update(enquiries).set({ transcript: null, providerSummary: null, facts: null }).where(where);
    await tx.update(callEvents).set({ payload: null }).where(lt(callEvents.receivedAt, cutoff));
    await audit(tx, SYSTEM, "data.purged", "enquiry", null, { transcripts: n, cutoff: cutoff.toISOString() });
  });
  console.log(`✔ purged ${n} transcripts and old provider payloads`);
}
main().catch((e) => { console.error("✖", e.message); process.exitCode = 1; }).finally(closeDb);
