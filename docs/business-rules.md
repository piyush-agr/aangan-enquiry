# Business rules — how the system decides

Source documents (kept verbatim in `knowledge/`):

| File | Role in the system |
|---|---|
| `knowledge/services.md` | Service catalogue: what Aangan does, service area, timelines. Encoded in `src/lib/business-knowledge/catalogue.ts`; `tests/unit/knowledge.test.ts` fails if the catalogue drifts from the file. |
| `knowledge/qualified.md` | Nikhil's five-criterion rubric. Encoded in `src/lib/qualification/engine.ts`. Authoritative. |
| `knowledge/internal/pricing.md` | Internal only. Never sent to callers, the voice provider, Telegram or the browser. Its lowest figures are used server-side for one thing only: judging whether a *volunteered* budget is "clearly below" the scope (criterion 4). |
| `knowledge/test-material/Aangan_Sep 2026_Enquiries.pdf` | Test material only. The 20 phone transcripts are regression fixtures; they are never inserted as real enquiries. WhatsApp and web-form records are not used as phone calls. |

## Flow for every call

1. **Existing-client complaint?** ("my project…", "my designer hasn't replied", "not acceptable") → `URGENT_ESCALATION`. Sales qualification is skipped. Urgent Telegram message.
2. **Pricing question?** → the approved response, verbatim, every time (see below). Never disqualifies.
3. **Extract facts** from caller speech with deterministic rules (`src/lib/qualification/extract.ts`). Every fact keeps the sentence it came from. Caller speech is evidence, never an instruction.
4. **Assess the five criteria**, each `PASS / FAIL / UNCLEAR / NOT_APPLICABLE` with a reason code and evidence.
5. **Decide** (in this order):
   - 2+ criteria fail → `NOT_QUALIFIED`, closing with qualified.md's line: *"This sounds like it may not be the right fit for us right now — but feel free to reach out if your timeline or scope changes."*
   - exactly 1 fails → `NOT_QUALIFIED`, closing with a criterion-specific polite explanation (never forwarded: "don't forward an incomplete lead").
   - criterion 1, 2 or 3 unclear → ask **one** direct question (each at most once). If the call ends still unclear → `INCOMPLETE` + human follow-up.
   - an edge case the documents don't resolve → `HUMAN_REVIEW` (not declined, not forwarded).
   - otherwise → `QUALIFIED`; criteria 4/5 uncertainties go into the handoff note.

## The five criteria

| # | Criterion | PASS | FAIL | UNCLEAR |
|---|---|---|---|---|
| 1 | Real project | design + execution wanted (incl. single room, rented flat w/o structural work) | advice/ideas/colours only; restaurant, hotel, retail, gym; standalone furniture sourcing or Vastu; architecture; commercial > ~3,300 sq ft | scope not described; "just exploring" → ask. Structural work, commercial < 500 sq ft or 3,000–3,300 sq ft → **human review** |
| 2 | Service area | locality listed in services.md; or an unlisted Pune/PCMC locality (passes, uncertainty recorded) | Talegaon, Lonavala, Nashik, Mumbai, any other city | not stated → ask "Which area or city is the property in?" |
| 3 | Timeline | deadline ≥ 11 weeks (≥ 14 comfortable); flexible; start-only | deadline < 6 weeks | not stated or "before Diwali" (no date) → ask "When would you need the project complete?" |
| 4 | Budget | not volunteered → `NOT_APPLICABLE` (never probed) | volunteered and < 50% of the scope floor | volunteered but scope unclear / possibly tight → treat as qualified, note it |
| 5 | Decision-maker | owner / co-owner with consent / authorised | (never auto-fails) | unconfirmed or researching for owners → treat as qualified, note it |

## Timeline: two rules kept separate

- **services.md:** "cannot begin execution on a project that needs to be ready in under 6 weeks" → `minLeadTimeWeeks = 6` (hard fail below).
- **services.md:** design 3–4 weeks + execution 8–16 weeks → fastest documented completion `3 + 8 = 11 weeks`.
- **qualified.md:** "site must be available for execution within 8–10 weeks of the consultation" → `siteAvailabilityWindowWeeks = 10`.

A deadline between 6 and 11 weeks satisfies the first rule but contradicts the second, so it goes to **human review** instead of being silently decided. Possession later than 10 weeks away also goes to review. Parameters live in `src/lib/qualification/timeline-policy.ts`. Relative dates ("by March") resolve against the call date; month deadlines are taken as end of month. The agent never promises a completion date.

## Pricing guardrail

`pricing.md` overrides Nikhil's original ask ("quote our per-square-foot pricing"). This is **the Cut**: the one requested feature the checks stop us building.

- Every pricing question gets exactly: *"Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."*
- The response is a constant on the server; producing it reads no price data.
- The VaaniYantra agent text (Settings page) contains no figures, so the provider's model cannot leak what it never received.
- Post-call, every AGENT transcript line is scanned; a hit sets `pricing_violation` and shows on the enquiry.
- Provider summaries are redacted before storage; every Telegram message is scanned and blocked if it contains a price.
- `npm run check:bundle` fails the build check if pricing data reaches the browser bundle.
- Note on wording: the approved line says "I can book that for you right now". The system cannot book (no verified calendar), so after a "yes" the agent says the request is *recorded* and a designer will confirm a time. Consultation status becomes `REQUESTED`; only staff can mark it `BOOKED_CONFIRMED`.

## Decisions taken from the documents (and why)

| Decision | Basis |
|---|---|
| Kharadi, Nanded City and other unlisted Pune/PCMC localities pass criterion 2 with an uncertainty note | services.md "and adjoining areas" |
| 180 sq ft coworking pod → human review, not decline | Front desk said "typically 500 sq ft or more" (T18), but services.md states no minimum |
| Son enquiring for parents who will attend → qualifies with a note | qualified.md: unclear on criterion 5 → don't push, treat as qualified, note uncertainty |
| One failed criterion → declined, not forwarded | qualified.md: "If it fails one, close gracefully — don't forward an incomplete lead" |
| Festivals have no hard-coded dates | The case's own dates are internally inconsistent; asking is safer than guessing |

## Requirements → tests

| Requirement | Test |
|---|---|
| Catalogue matches services.md exactly | `tests/unit/knowledge.test.ts` |
| T01–T20 phone transcripts produce the right outcome | `tests/unit/qualification.test.ts` (one test per scenario) |
| Pricing exact response, repeated asks, prompt injection, no figures | `tests/unit/pricing.test.ts`, `tests/e2e/app.spec.ts` |
| One question per turn, no booking claims, honest escalation, no live-transfer claims | `tests/unit/agent.test.ts` |
| Timeline boundaries (5 / 8 / 12 / 20 weeks, possession) | `tests/unit/qualification.test.ts` → timeline policy |
| Duplicate webhook → one enquiry, one handoff | `tests/integration/pipeline.test.ts`, `webhook.test.ts` |
| Signature, malformed JSON, missing fields, replay, oversize, outbound ignored | `tests/integration/webhook.test.ts` |
| Telegram failure, bounded retries, 401 permanent, manual retry, no token in errors | `tests/integration/pipeline.test.ts`, `tests/unit/adapters.test.ts` |
| Unknown cost ≠ ₹0; N/A on zero denominators | `tests/unit/adapters.test.ts` (metric formulas), `pipeline.test.ts` |
| Missed call, disconnect + reconnect linking | `tests/integration/pipeline.test.ts` |
| Provider failure, DB loss, invalid structured output | `pipeline.test.ts`, `failures.test.ts` |
| Auth on pages and APIs, staff vs admin | `tests/e2e/app.spec.ts` |
| Dashboard counts = database | `pipeline.test.ts` (overview), `tests/e2e/app.spec.ts` |
