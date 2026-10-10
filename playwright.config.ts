import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://aangan:aangan_dev@localhost:5432/aangan_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {} },
    },
  ],
  webServer: {
    // Uses the production build (`npm run build` first). Isolated e2e database, mock voice, no Telegram.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ENV: "test",
      DATABASE_URL: E2E_DB,
      SESSION_SECRET: "e2e-session-secret-0123456789-abcdefghijklmnopq",
      VOICE_PROVIDER: "mock",
      APP_BASE_URL: `http://localhost:${PORT}`,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_DESIGNER_CHAT_ID: "",
      CRON_SECRET: "e2e-cron",
    },
  },
});
