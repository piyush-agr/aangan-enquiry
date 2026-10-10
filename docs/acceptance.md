# Acceptance checklist

PASS = verified by an automated test or a run recorded in the final report. BLOCKED = needs an external account. NOT TESTED = not verified.

| Area | Criterion | Status | Evidence |
|---|---|---|---|
| Business | Service catalogue matches services.md | PASS | `knowledge.test.ts` |
| Business | Five criteria match qualified.md (incl. boundary rules) | PASS | `qualification.test.ts` |
| Business | Timeline ambiguity handled explicitly (6-wk vs 3+8 vs 8–10-wk window) | PASS | timeline policy tests |
| Business | Pricing numbers never disclosed | PASS | `pricing.test.ts`, `agent.test.ts`, e2e, bundle scan |
| Business | Existing-client complaints escalate | PASS | qualification/agent/pipeline/e2e |
| Business | Missed and failed calls recorded accurately | PASS | `pipeline.test.ts`, `webhook.test.ts` |
| Business | Out-of-scope channels not implemented | PASS | `channel` enum = PHONE; outbound webhooks ignored |
| Functional | Events processed through the provider abstraction | PASS | `webhook.test.ts`, `pipeline.test.ts` |
| Functional | Mock mode works without credentials | PASS | e2e |
| Functional | Qualified → handoff attempt; unqualified → none; urgent → escalation | PASS | `pipeline.test.ts` |
| Functional | Notification status tracked | PASS | `pipeline.test.ts` |
| Functional | Costs categorised actual/estimated/unknown | PASS | `pipeline.test.ts`, `adapters.test.ts` |
| Functional | Dashboard sourced from persisted records | PASS | overview test, e2e counts |
| Reliability | Duplicate webhooks idempotent | PASS | `pipeline.test.ts`, `webhook.test.ts` |
| Reliability | Invalid payloads rejected safely | PASS | `webhook.test.ts`, `failures.test.ts` |
| Reliability | Provider/Telegram failures keep the enquiry | PASS | `pipeline.test.ts` |
| Security | No committed secrets | PASS | `.gitignore`, bundle scan, repo grep in final report |
| Security | Dashboard and sensitive APIs protected, admin-only settings | PASS | e2e |
| Security | Webhooks verified per VaaniYantra's documented HMAC | PASS (against docs) | `webhook.test.ts`, `adapters.test.ts` |
| Quality | Lint, type check, unit, integration, e2e, production build | PASS | final report |
| External | VaaniYantra live calls | BLOCKED | needs workspace, number, API key, webhook secret |
| External | Telegram real delivery | BLOCKED | needs bot token + chat id |
| External | Five-minute compliance on real calls | BLOCKED | needs live calls |
