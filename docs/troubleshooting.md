# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App won't start: "Invalid configuration — DATABASE_URL…" | Missing/short env var | Compare `.env` with `.env.example`. `SESSION_SECRET` needs ≥ 32 chars. |
| `/api/health` → `"database":"error"` | DB down or wrong URL | Check `DATABASE_URL`; for Supabase use the pooler URL with `sslmode=require`. |
| Banner "VaaniYantra misconfigured" | `VOICE_PROVIDER=vaaniyantra` without `VAANIYANTRA_WEBHOOK_SECRET` | Add the `whsec_` secret from VaaniYantra Settings → Webhooks. |
| Webhooks return 401 | Wrong secret, or a proxy changed the body | Re-copy the secret; make sure nothing re-encodes JSON before the app. |
| Webhooks return 503 | App is in mock mode, or the DB is unreachable | Set `VOICE_PROVIDER=vaaniyantra`; check health. |
| Enquiries have no transcript, first response "not measurable" | API key missing or lacks `calls:read` | Add `VAANIYANTRA_API_KEY`. The event's error shows "enrichment: …". |
| Handoff "Telegram not set up" | Token/chat id missing | See `docs/telegram.md`. Then "Resend to Telegram" on each enquiry. |
| Handoff FAILED with AUTH | Bot token wrong or revoked | New token from @BotFather. |
| Handoff FAILED with BAD_REQUEST "chat not found" | Wrong chat id or bot not in the group | Add the bot to the group; re-read `getUpdates`. |
| Costs say "Unknown" | No rate configured | Settings → Cost rates. |
| Red box "provider events failed to process" | Processing error (shown) | Fix the cause; the cron job retries up to 5 times. Or call `/api/jobs/reprocess` with the cron secret. |
| `npm run db:seed` → "server-only" error | Script run without the react-server condition | Use the npm scripts (they pass `--conditions=react-server`). |
| Playwright can't find Chromium | Browser not installed | `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH`. |
