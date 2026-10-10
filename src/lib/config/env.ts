import { z } from "zod";

/**
 * Central, validated configuration. Every environment variable the app reads is declared here
 * (and documented in .env.example). Missing optional integrations produce warnings, never crashes.
 *
 * NOTE: the VAANIYANTRA_* names are this application's own names. VaaniYantra itself only
 * defines the *values* (an API key starting `ck_live_`, a webhook secret starting `whsec_`).
 */
const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  STUDIO_TIMEZONE: z.string().default("Asia/Kolkata"),

  VOICE_PROVIDER: z.enum(["mock", "vaaniyantra"]).default("mock"),
  VAANIYANTRA_API_BASE_URL: z.string().url().default("https://vaaniyantra.com/api/v1"),
  VAANIYANTRA_API_KEY: z.string().optional(),
  VAANIYANTRA_WEBHOOK_SECRET: z.string().optional(),
  VAANIYANTRA_AGENT_ID: z.string().optional(),
  WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_DESIGNER_CHAT_ID: z.string().optional(),
  TELEGRAM_URGENT_CHAT_ID: z.string().optional(),
  TELEGRAM_SEND_DEMO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),

  CRON_SECRET: z.string().optional(),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
});

export type AppConfig = z.infer<typeof schema>;

export interface IntegrationStatus {
  voiceProvider: "mock" | "vaaniyantra";
  voiceMode: "MOCK" | "LIVE" | "MISCONFIGURED";
  vaani: { apiKey: boolean; webhookSecret: boolean; agentId: boolean };
  telegram: { configured: boolean; urgentChat: boolean; sendDemo: boolean };
  cron: boolean;
  warnings: string[];
}

let cached: AppConfig | null = null;

function blankToUndefined(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) out[k] = v === "" ? undefined : v;
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(blankToUndefined(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration — ${issues}. See .env.example.`);
  }
  return parsed.data;
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** For tests only. */
export function resetConfigCache() {
  cached = null;
}

export function integrationStatus(cfg: AppConfig = config()): IntegrationStatus {
  const warnings: string[] = [];
  const vaani = {
    apiKey: Boolean(cfg.VAANIYANTRA_API_KEY),
    webhookSecret: Boolean(cfg.VAANIYANTRA_WEBHOOK_SECRET),
    agentId: Boolean(cfg.VAANIYANTRA_AGENT_ID),
  };
  let voiceMode: IntegrationStatus["voiceMode"] = "MOCK";
  if (cfg.VOICE_PROVIDER === "vaaniyantra") {
    if (!vaani.webhookSecret) {
      voiceMode = "MISCONFIGURED";
      warnings.push("VOICE_PROVIDER=vaaniyantra but VAANIYANTRA_WEBHOOK_SECRET is missing — webhooks will be rejected (fail closed).");
    } else {
      voiceMode = "LIVE";
    }
    if (!vaani.apiKey) {
      warnings.push("VAANIYANTRA_API_KEY is missing — transcripts and start times cannot be fetched; only webhook summary data will be stored.");
    }
  } else {
    warnings.push("Voice provider is in MOCK mode — no real phone calls are being received.");
  }
  const telegramConfigured = Boolean(cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_DESIGNER_CHAT_ID);
  if (!telegramConfigured) {
    warnings.push("Telegram is not configured — handoffs are recorded as UNAVAILABLE and shown in the dashboard instead.");
  }
  if (!cfg.CRON_SECRET) {
    warnings.push("CRON_SECRET is not set — the background re-processing endpoint is disabled.");
  }
  if (cfg.APP_ENV === "production" && cfg.SESSION_SECRET.startsWith("dev-")) {
    warnings.push("SESSION_SECRET looks like a development value in production.");
  }
  return {
    voiceProvider: cfg.VOICE_PROVIDER,
    voiceMode,
    vaani,
    telegram: {
      configured: telegramConfigured,
      urgentChat: Boolean(cfg.TELEGRAM_URGENT_CHAT_ID),
      sendDemo: cfg.TELEGRAM_SEND_DEMO,
    },
    cron: Boolean(cfg.CRON_SECRET),
    warnings,
  };
}
