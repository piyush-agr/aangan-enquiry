import { sql } from "drizzle-orm";
import { resetConfigCache } from "@/lib/config/env";
import { closeDb, db } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

let migrated = false;

/** Fresh schema once per test run, then truncation between tests. Only ever runs against aangan_test. */
export async function setupDb() {
  if (!/aangan_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run integration tests against a non-test database");
  if (!migrated) {
    await db().execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await runMigrations();
    migrated = true;
  }
}

export async function truncateAll() {
  await db().execute(sql`truncate table audit_events, cost_records, cost_rates, notifications, qualification_assessments, call_events, enquiries, sessions, users restart identity cascade`);
}

export function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
}

export { closeDb };
