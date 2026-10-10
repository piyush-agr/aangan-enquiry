# API

All endpoints except `/api/health`, the webhook and the cron job need a session cookie (sign in at `/login`). JSON in, JSON out.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | `{ status, database, voice.mode, telegram, warnings }`. No secrets, DB errors redacted. 503 if the DB is down. |
| POST | `/api/webhooks/vaaniyantra` | HMAC signature | VaaniYantra `call.completed` / `call.failed`. 401 bad/missing signature, 400 invalid, 413 > 256 KB, 429 rate-limited, 503 mock mode or DB down, 200 accepted/duplicate/ignored. |
| GET/POST | `/api/jobs/reprocess` | `Bearer CRON_SECRET` | Re-processes events left PENDING/FAILED (max 5 attempts each). |
| POST | `/api/auth/login` | public, rate-limited 10/15 min/IP | `{ email, password }` → session cookie (httpOnly, SameSite=Lax, Secure in production, 12 h). |
| POST | `/api/auth/logout` | session | Ends the session. |
| GET | `/api/enquiries` | staff | Filters: `q, disposition, callStatus, notification, review, category, locality, from, to (YYYY-MM-DD), demo (0/1/only), sort (newest/oldest/priority), page, pageSize ≤ 100`. |
| GET | `/api/enquiries/:id` | staff | Enquiry + assessments + notifications + costs + events + audit. Transcript only for admins. |
| PATCH | `/api/enquiries/:id` | staff | `{ disposition?, consultationStatus?, conversionStatus?, projectValueInr?, humanReviewStatus?, note? }`. Audited. Changing to QUALIFIED/URGENT sends the handoff once. |
| POST | `/api/notifications/:id/retry` | staff | Resend a FAILED/UNAVAILABLE notification. 409 if already delivered. |
| GET | `/api/metrics?from&to&demo=1` | staff | The same numbers as the overview, with numerators and denominators. |
| POST | `/api/simulator/turn` | staff | `{}` starts a call; `{ text, state, sig }` sends a caller turn. State is HMAC-signed. |
| POST | `/api/simulator/finish` | staff | `{ state, sig, outcome: COMPLETED/DISCONNECTED/MISSED, callerPhone?, simulateProviderFailure?, simulateTelegramFailure? }` → demo enquiry through the real pipeline. |
| POST | `/api/settings/rates` | admin | `{ provider, category: voice_minute/telephony_minute, unit: minute/minute_rounded_up, rate, currency, source }` |
| POST | `/api/settings/actual-cost` | admin | `{ provider, amount, currency, periodEnd, note }` |
| POST | `/api/demo/clear` | admin | `{ confirm: "DELETE DEMO DATA" }` deletes demo records only. |

## Webhook processing

1. Verify signature (raw body) → validate schema → reject stale timestamps.
2. Insert into `call_events` with a unique dedupe key. A repeat increments `deliveries` and returns `duplicate: true`.
3. Respond 200, then (after the response): fetch call detail, extract facts, assess, upsert the enquiry, record costs and audit, link reconnections, send the notification.
4. Any failure leaves the event FAILED with the error. The cron job retries.
