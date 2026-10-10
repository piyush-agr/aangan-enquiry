# Telegram designer handoff

**Why Telegram over email:** the case is about speed. A bot message lands on the designer's phone in seconds with a push notification. Email gets batched, filtered and read later, which recreates the "answered next day" problem the 4× conversion figure warns about. The bot API is free and simple, and delivery is confirmed with a message id we store. The dashboard stays the system of record, so a Telegram outage never loses an enquiry.

## Setup (about 5 minutes)

1. In Telegram, message **@BotFather** → `/newbot` → copy the token (`123456:ABC…`).
2. Create a group for designers, add the bot, send any message in the group.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `chat.id` (a negative number for groups).
4. Optional: a second group for urgent existing-client escalations (Nikhil + senior team).
5. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DESIGNER_CHAT_ID`, optionally `TELEGRAM_URGENT_CHAT_ID`. Redeploy.
6. To try it with the simulator, set `TELEGRAM_SEND_DEMO=true` (demo messages start with "🧪 DEMO — SIMULATED CALL, NOT A REAL ENQUIRY").

## Behaviour

| Enquiry outcome | Message |
|---|---|
| Qualified | New qualified enquiry (designer chat) |
| Urgent escalation | Urgent existing-client message (urgent chat, or designer chat) |
| Missed call | Missed-call notice for manual callback |
| Declined / incomplete / review | **No message.** Visible in the dashboard only |

- Plain text, no Markdown parsing, so caller words can't inject formatting.
- Contains no transcript, no volunteered budget, no internal prices; every message is scanned and blocked if it looks like it contains a price.
- Includes a link to the login-protected enquiry page only when `APP_BASE_URL` is set. No tokens in links.
- One message per enquiry per category (database unique index + row lock), so duplicate webhooks can't double-send.
- Up to 3 attempts with backoff for network errors, timeouts, 429 (honours `retry_after`) and 5xx. 400/401/403/404 are permanent and not retried.
- Failures are stored with a category; staff resend from the enquiry page ("Resend to Telegram"). Resends are audited.
- Not configured → status "Telegram not set up" (`UNAVAILABLE`), clearly separate from a failed delivery.
