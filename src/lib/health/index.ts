import { sql } from "drizzle-orm";
import { config, integrationStatus } from "@/lib/config/env";
import { db } from "@/lib/db/client";

export async function healthReport() {
  let database: "ok" | "error" = "ok";
  let dbError: string | undefined;
  try {
    await db().execute(sql`select 1`);
  } catch (e) {
    database = "error";
    dbError = (e as Error).message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[redacted-url]").slice(0, 200);
  }
  const s = integrationStatus();
  return {
    status: database === "ok" ? (s.voiceMode === "MISCONFIGURED" ? "degraded" : "ok") : "error",
    env: config().APP_ENV,
    database,
    dbError,
    voice: { provider: s.voiceProvider, mode: s.voiceMode },
    telegram: s.telegram.configured ? "configured" : "not-configured",
    warnings: s.warnings.length,
    time: new Date().toISOString(),
  };
}
