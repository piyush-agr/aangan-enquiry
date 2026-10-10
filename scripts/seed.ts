import "./load-env";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth/password";
import { runScript } from "../src/lib/conversation/agent";
import { SCENARIOS } from "../src/lib/conversation/scenarios";
import { closeDb, db } from "../src/lib/db/client";
import { users } from "../src/lib/db/schema";
import { ingest } from "../src/lib/telephony-events/ingest";
import { simulatedCallEvent } from "../src/lib/voice-provider/mock";

/**
 * npm run db:seed            → creates/updates the admin user from ADMIN_EMAIL / ADMIN_PASSWORD
 * npm run db:seed -- --demo  → also runs every simulator scenario as clearly-flagged DEMO records
 * Transcripts are never inserted as real enquiries.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    // In the Vercel build (--optional) a missing admin is a warning, not a failed deploy.
    if (process.argv.includes("--optional")) return console.warn("⚠ ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin user created.");
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) to seed the admin user.");
  }
  const hash = await hashPassword(password);
  const [existing] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) await db().update(users).set({ passwordHash: hash, role: "ADMIN" }).where(eq(users.id, existing.id));
  else await db().insert(users).values({ email, name: process.env.ADMIN_NAME ?? "Nikhil Deshpande", role: "ADMIN", passwordHash: hash });
  console.log(`✔ admin user ready: ${email}`);

  const wantDemo = process.argv.includes("--demo") || process.env.SEED_DEMO === "true";
  const existingDemo = ((await db().execute(sql`select count(*)::int as n from enquiries where is_demo`)).rows[0] as { n: number } | undefined)?.n ?? 0;
  if (wantDemo && existingDemo > 0) console.log(`  demo data already present (${existingDemo} records) — not adding more`);
  if (wantDemo && existingDemo === 0) {
    let i = 0;
    let prev = new Date();
    for (const s of SCENARIOS) {
      // spread over the last few days; the reconnection follows its dropped call by two minutes
      const started = s.id === "reconnect" ? new Date(prev.getTime() + 2 * 60_000) : new Date(Date.now() - (SCENARIOS.length - i) * 5 * 3600 * 1000);
      i++;
      prev = started;
      const { state } = runScript(s.lines, started);
      const ev = simulatedCallEvent({ state: s.outcome === "MISSED" ? undefined : state, outcome: s.outcome, callerPhone: s.callerPhone, startedAt: started, simulateProviderFailure: s.inject?.providerFailure });
      const r = await ingest(ev, undefined, { simulateNotificationFailure: s.inject?.telegramFailure });
      console.log(`  demo ${s.id.padEnd(18)} → ${r.status}`);
    }
    console.log("✔ demo scenarios ingested (flagged DEMO; excluded from production metrics)");
  }
}

main()
  .catch((e) => {
    console.error("✖", e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
