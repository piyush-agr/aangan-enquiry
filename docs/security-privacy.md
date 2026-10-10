# Security and privacy

## Access
- Dashboard and APIs need a session. Passwords: scrypt (node:crypto). Session tokens: 32 random bytes in an httpOnly cookie; only an HMAC of the token is stored. 12-hour expiry.
- Roles: **ADMIN** (Nikhil): settings, rates, invoices, demo deletion, transcripts. **STAFF**: enquiries, outcomes, resends. Transcripts are admin-only.
- Limitation: there is no in-app user management. Add staff with a SQL insert or extend `scripts/seed.ts`. No password reset flow, no 2FA. Acceptable for a two-person front desk plus Nikhil; revisit before wider rollout.
- Login is rate-limited (in-memory, per instance; add a platform/WAF limit in production).

## Webhooks
- HMAC-SHA256 over the raw body, constant-time compare, **fail closed** when the secret is missing.
- Body ≤ 256 KB, schema-validated, event header must match body, timestamps older than `WEBHOOK_MAX_AGE_SECONDS` rejected, per-IP rate limit, idempotent.
- Rejected webhooks are logged and audited without storing their payload.

## Model output and caller input
- Caller speech is evidence. "Ignore your instructions…" is detected, logged and answered with a refusal or the pricing line.
- Qualification is deterministic code. Provider `summary` text is stored for reference (price-redacted) and never used for decisions. `collectedData` must be flat primitives (nested objects → 400); only location/timeline keys feed the rules.
- The simulator's state round-trips through the browser and is HMAC-signed so it can't be edited.

## What is stored
| Data | Where | Who sees it |
|---|---|---|
| Caller phone number (from provider metadata) | `enquiries.caller_phone` | Staff, Telegram handoff (needed to call back) |
| Name, project details, timeline, budget if volunteered | `enquiries` | Staff. Budget never sent to Telegram |
| Transcript | `enquiries.transcript` | Admins only. Never sent to Telegram |
| Raw provider event (normalised) | `call_events.payload` | Database only, for reprocessing |
| Recording URL (if the provider sends one) | in the event payload only | Not shown. Recording should stay off (below) |
| Audit trail | `audit_events` | Phone numbers masked (`+91•••••3210`) |

- **Retention:** `npm run data:purge -- --apply` removes transcripts, provider summaries, extracted facts and raw payloads older than `DATA_RETENTION_DAYS` (default 365). Run monthly (or schedule it). Structured fields stay for reporting.
- **Deletion requests:** delete the caller's rows from `enquiries` (cascades to assessments, notifications, costs). Also delete the call in VaaniYantra's call history.
- **Recordings:** keep call recording off in VaaniYantra until the greeting includes a recording disclosure and consent/retention rules under India's DPDP Act 2023 have been reviewed. The greeting already says the caller is speaking to a virtual assistant.
- **Provider data:** VaaniYantra processes call audio and transcripts as the voice provider. Review its terms for data use and storage location before go-live.
- Logs are structured JSON with masked phone numbers; no transcripts or secrets are logged. The Telegram bot token is never written to logs or the database.
- Secrets live only in environment variables. `.env` is git-ignored.
