import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "@/lib/config/env";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __aanganPool?: Pool; __aanganDb?: DB };

export function pool(): Pool {
  if (!globalForDb.__aanganPool) {
    const url = config().DATABASE_URL;
    globalForDb.__aanganPool = new Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      ssl: /sslmode=require|supabase\.co|pooler\.supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    globalForDb.__aanganPool.on("error", (err) => console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message })));
  }
  return globalForDb.__aanganPool;
}

export function db(): DB {
  if (!globalForDb.__aanganDb) globalForDb.__aanganDb = drizzle(pool(), { schema });
  return globalForDb.__aanganDb;
}

export async function closeDb() {
  await globalForDb.__aanganPool?.end();
  globalForDb.__aanganPool = undefined;
  globalForDb.__aanganDb = undefined;
}

export { schema };
