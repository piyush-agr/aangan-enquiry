# Cost methodology

Three kinds of cost are stored and **never added together**:

| Type | Meaning | Source |
|---|---|---|
| ACTUAL | Money actually charged | Provider-reported per-call cost (VaaniYantra's public API has none today), or an invoice an admin enters in Settings → "Record an actual invoice" (VaaniYantra monthly invoice, Vercel, Supabase…) |
| ESTIMATED | Billable minutes × a rate | Rate entered by an admin in Settings, with a mandatory "where this rate comes from" note. Every cost line keeps the rate and its source. |
| UNKNOWN | No rate configured | Stored with `amount = NULL`. Shown as "Unknown", never ₹0. |

No provider price is hard-coded. VaaniYantra's user guide says "from ₹5 / minute"; read your actual rate in VaaniYantra → Settings → Billing and enter it.

## Formulas (src/lib/analytics/metrics.ts)

- Billable minutes = `durationSec / 60` (pro-rated) or `ceil(durationSec / 60)` if the rate is "per started minute".
- Estimated call cost = billable minutes × rate. Separate lines for the voice platform (`voice_minute`) and, if configured, the phone carrier (`telephony_minute`, e.g. Twilio/Exotel).
- Estimated cost per call / per completed call / per qualified enquiry / per won project = estimated call costs ÷ the count for the same period. **N/A** if the count is zero or any call in the period has an unknown cost.
- Actual cost per qualified enquiry = actual costs in the period ÷ qualified enquiries.
- Demo calls are costed (with the VaaniYantra rate, labelled "DEMO estimate") but excluded unless "Include demo calls" is ticked.
- Telegram Bot API calls are free; no cost lines are created for them.

## What it is generating

- Consultations requested (on the call), booked (confirmed by staff), held.
- Conversion rate = won ÷ (won + lost) for enquiries arriving in the period. "Not yet recorded" until staff record outcomes.
- Project value won = sum of values staff record on won enquiries. Never estimated from the case's ₹8–14 lakh average.
