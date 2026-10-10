import { execSync } from "node:child_process";
import { Client } from "pg";
import { E2E_DB } from "../../playwright.config";

/** Fresh e2e database: drop everything, migrate, create an admin and a staff user. */
export default async function globalSetup() {
  if (!/aangan_e2e/.test(E2E_DB)) throw new Error("Refusing to reset a non-e2e database");
  const c = new Client({ connectionString: E2E_DB });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await c.end();
  const env = { ...process.env, DATABASE_URL: E2E_DB, SESSION_SECRET: "e2e-session-secret-0123456789-abcdefghijklmnopq", ADMIN_PASSWORD: "e2e-admin-password", APP_ENV: "test" };
  execSync("npx tsx --conditions=react-server scripts/migrate.ts", { env, stdio: "inherit" });
  execSync("npx tsx --conditions=react-server scripts/seed.ts", { env: { ...env, ADMIN_EMAIL: "admin@e2e.test" }, stdio: "inherit" });
  execSync(`npx tsx --conditions=react-server tests/e2e/create-staff.ts`, { env, stdio: "inherit" });
}
