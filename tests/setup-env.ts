// Isolated test configuration — never points at a production database.
process.env.APP_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://aangan:aangan_dev@localhost:5432/aangan_test";
process.env.SESSION_SECRET = "test-session-secret-0123456789-abcdefghijklmnop";
process.env.VOICE_PROVIDER = process.env.VOICE_PROVIDER ?? "mock";
process.env.VAANIYANTRA_WEBHOOK_SECRET = "whsec_test_secret";
process.env.VAANIYANTRA_API_KEY = "";
process.env.TELEGRAM_BOT_TOKEN = "";
process.env.TELEGRAM_DESIGNER_CHAT_ID = "";
process.env.CRON_SECRET = "test-cron-secret";
