# Vaani AI integration (app.vaanivoice.ai)

**Status: implemented against docs.vaanivoice.ai (read 10 Oct 2026), tested with signed sample payloads; connect a live agent to verify.**

## What the docs define (and the code relies on)

| Topic | Documented | Code |
|---|---|---|
| Auth | `X-API-Key: vaani_…`, base `https://api.vaanivoice.ai` | `fetchVaaniHistory` |
| Events (inbound) | `call_started` {room_name, status, phone_number} · `user_picked_up_at` · `call_ended` {call_duration s, end_reason} · `call_postprocessing` {call_id, timestamp, data:{room_name, call_duration ms, end_reason, summary, entities, dispositions, recording_url, transcript}} | `parseVaani` |
| Outbound-only events | ringing, rejected, no_answer, failed | ignored (out of scope) |
| Signature | `X-Vaani-Signature: sha256=<hex HMAC-SHA256(secret, "<ts>.<raw body>")>`, `X-Vaani-Timestamp` (unix s), reject if > 300 s skew | `verifyVaani` |
| Retries | 5 attempts (0, 5, 25, 125, 625 s) on non-2xx | idempotent receipt per (event, room) |
| Transcript | `"[HH:MM:SS] AGENT: …\n\n[HH:MM:SS] USER: …"` | `parseVaaniTranscript` |
| Call history | `GET /api/call-history?page&page_size` → `call_id, from_number, direction, Start_time, End_time, duration_ms, call_cost` (credits) | caller-number fallback + cost |

Not documented, so handled conservatively: whether dashboard *Agent Webhook* deliveries carry the signature headers (we also accept a `?key=<secret>` URL token); whether transcript stamps are offsets or clock time (first-response time is only derived when stamps start near 0 and increase); ₹ value of a credit (enter it in Settings → Cost rates as "Vaani credits (₹ per credit)").

## How a call is joined

`call_started` arrives live → we store its arrival time and the caller's `phone_number`. `call_postprocessing` arrives later with the transcript → we join by `room_name`, extract facts, run the five criteria, save, cost and notify. Arrival = receipt of `call_started` (its payload has no timestamp).

## Connect it (no code changes)

1. **Vaani → Agents → create** an inbound agent. Paste the greeting, description and knowledge text from this app's **Settings** page. Do not upload pricing.md. Language English (India).
2. Optional but useful: **Post-call analysis → data points** `name`, `property_location`, `timeline` (the app maps these; everything else is display-only).
3. **Settings → Telephony**: provision a number (or connect a SIP trunk) and set it as the agent's **Inbound** number.
4. **Developers → API Keys → Create Key**. **Developers → Webhooks → New End Point → Agent Webhook**: URL `https://aangan-enquiry-inky.vercel.app/api/webhooks/vaani?key=<secret>`, Signing Secret = the same `<secret>`.
5. Vercel env: `VOICE_PROVIDER=vaani`, `VAANI_API_KEY`, `VAANI_WEBHOOK_SECRET=<secret>`. Redeploy.
6. Call the number. The enquiry should appear within a few seconds of the call ending; check Developers → Logs if not.
