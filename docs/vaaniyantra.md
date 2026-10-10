# VaaniYantra integration

**Status: implemented against the public documentation, mocked in tests, not yet tested against a live VaaniYantra workspace** (no account credentials were available while building).

The invite sheet in the course materials ("Vaani Platform Invite codes for Mesa") points to the VaaniYantra platform. Everything below comes from its public guides, read on 10 Oct 2026:
- Developer guide: https://vaaniyantra.com/docs/developer-guide
- User guide: https://vaaniyantra.com/docs/user-guide

## What the docs confirm (and the code relies on)

| Topic | Documented behaviour | Where in code |
|---|---|---|
| Auth | API keys from Settings → API keys, prefix `ck_live_`, sent as `Authorization: Bearer`. Scope `calls:read` needed. | `vaaniyantra.ts → getCall` |
| Webhooks | Settings → Webhooks. Events `call.completed`, `call.failed`. JSON POST, 6 s timeout, redirects not followed. | `src/app/api/webhooks/vaaniyantra/route.ts` |
| Signature | `X-VaaniYantra-Signature: sha256=<hex HMAC-SHA256(raw body, whsec_ secret)>`; also `X-VaaniYantra-Event`. | `verify()` (constant-time compare, fails closed) |
| Payload | `{ event, timestamp, data: { id, direction, status, fromNumber, toNumber, durationSec, language, agent, summary, sentiment, sentimentScore, topics, collectedData, recordingUrl, createdAt, endedAt } }` | `webhookSchema` (zod) |
| Call detail | `GET /api/v1/calls/:id` adds `startedAt` and `transcript[{ role: AGENT\|CALLER, text, atMs }]` | `enrich()` |
| Rate limit | 120 req/min per key; 429 + `Retry-After` | bounded retry honouring Retry-After |
| Telephony | Numbers via Twilio, Plivo or Exotel connected in VaaniYantra. Twilio/Plivo auto-configured; Exotel needs a Voicebot applet → `wss://vaaniyantra.com/exotel`. | Configured in VaaniYantra, not in this app |
| Languages | en-IN, Hindi, Tamil, Telugu, Malayalam and more | English only for now (rules tested in English) |
| Billing | "from ₹5 / minute", invoiced monthly per the user guide (the page's meta text says top-up balance; confirm with VaaniYantra). Rate and usage shown in Settings → Billing. | Not hard-coded. Enter your rate in the app's Settings. |

## What the docs do NOT confirm (so the code does not assume it)

- No per-event id → idempotency key is `(event, call id)`.
- Redelivery/retry policy is undocumented → we answer 200 quickly, store first, process after the response, and re-process failures with the cron job.
- No `answeredAt` and no per-call cost in the API. First response is derived from `startedAt + first AGENT atMs`, labelled with that method, and shown "not measurable" when the API key is missing. Costs are **estimated** from your configured rate or recorded as **unknown**.
- `direction` casing is not documented → normalised; outbound is ignored (out of scope).
- Status list is marked non-exhaustive → unknown statuses map conservatively (`call.failed` → FAILED).
- No custom tool/function calling is documented → the pricing guardrail on live calls is enforced by the agent text containing no figures plus post-call auditing, not by a server callback during the call.

## Going live (no code changes needed)

1. In VaaniYantra: **Agents → New agent**. Direction *inbound*, language *English (en-IN)*. Paste the greeting, description and knowledge document from this app's **Settings** page. Do **not** upload `pricing.md`.
2. Connect a phone number (Twilio/Plivo/Exotel) and bind it to the agent. Set business hours to 24×7 so after-hours calls are answered too. Leave human transfer off unless a real transfer number is staffed.
3. Leave call recording off until disclosure and consent are reviewed (see `docs/security-privacy.md`).
4. **Settings → API keys**: create a key with `calls:read`. **Settings → Webhooks**: add `https://<your-app>/api/webhooks/vaaniyantra` for `call.completed` and `call.failed`; copy the `whsec_` secret.
5. Set env vars: `VOICE_PROVIDER=vaaniyantra`, `VAANIYANTRA_API_KEY`, `VAANIYANTRA_WEBHOOK_SECRET`, optionally `VAANIYANTRA_AGENT_ID`. Redeploy.
6. Use the webhook's **Send test** button: the event should appear (and, being a sample, may be flagged incomplete). Then place a real test call and check the enquiry, its transcript, first-response time and cost line.
7. Enter the per-minute rate from Settings → Billing in this app's Settings, with its source.

## Things to verify on the first live calls

- `atMs` is measured from `startedAt` (assumed). If not, first-response times will be off; the method label on each enquiry makes this checkable.
- What `collectedData` keys your agent produces. Only `location`/`timeline`-like keys are mapped; the rest are displayed but not trusted for decisions.
- Whether VaaniYantra retries failed webhook deliveries.
