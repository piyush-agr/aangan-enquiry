/**
 * Telegram Bot API adapter (https://core.telegram.org/bots/api#sendmessage).
 * POST {base}/bot<token>/sendMessage  { chat_id, text, disable_web_page_preview }
 * Response: { ok: true, result: { message_id } } | { ok: false, error_code, description, parameters?: { retry_after } }
 *
 * The bot token is part of the URL, so error messages are built from status codes only — never from
 * the URL or the raw fetch error — to keep the token out of logs and the database.
 */

export type TelegramErrorCategory = "NOT_CONFIGURED" | "NETWORK" | "TIMEOUT" | "RATE_LIMITED" | "AUTH" | "BAD_REQUEST" | "FORBIDDEN" | "SERVER" | "BLOCKED_BY_GUARDRAIL";

export type SendResult =
  | { ok: true; messageId: string; attempts: number }
  | { ok: false; category: TelegramErrorCategory; detail: string; retryable: boolean; attempts: number };

export interface TelegramConfig {
  token?: string;
  apiBase: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, process.env.APP_ENV === "test" ? Math.min(ms, 5) : ms));

export async function sendTelegramMessage(cfg: TelegramConfig, chatId: string | undefined, text: string, fetchImpl: typeof fetch = fetch, maxAttempts = 3): Promise<SendResult> {
  if (!cfg.token || !chatId) return { ok: false, category: "NOT_CONFIGURED", detail: "bot token or chat id missing", retryable: false, attempts: 0 };
  const url = `${cfg.apiBase.replace(/\/$/, "")}/bot${cfg.token}/sendMessage`;
  let last: SendResult = { ok: false, category: "NETWORK", detail: "not attempted", retryable: true, attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let waitMs = 500 * 2 ** (attempt - 1);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8_000),
      });
      let body: { ok?: boolean; result?: { message_id?: number }; error_code?: number; description?: string; parameters?: { retry_after?: number } } = {};
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (res.ok && body.ok && body.result?.message_id !== undefined) {
        return { ok: true, messageId: String(body.result.message_id), attempts: attempt };
      }
      const code = body.error_code ?? res.status;
      const desc = (body.description ?? `HTTP ${res.status}`).slice(0, 200);
      if (code === 429) {
        waitMs = Math.min((body.parameters?.retry_after ?? 1) * 1000, 5_000);
        last = { ok: false, category: "RATE_LIMITED", detail: desc, retryable: true, attempts: attempt };
      } else if (code >= 500) {
        last = { ok: false, category: "SERVER", detail: desc, retryable: true, attempts: attempt };
      } else if (code === 401 || code === 404) {
        // 404 from the Bot API means the token is wrong.
        return { ok: false, category: "AUTH", detail: "bot token rejected", retryable: false, attempts: attempt };
      } else if (code === 403) {
        return { ok: false, category: "FORBIDDEN", detail: desc, retryable: false, attempts: attempt };
      } else {
        return { ok: false, category: "BAD_REQUEST", detail: desc, retryable: false, attempts: attempt };
      }
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      last = { ok: false, category: timeout ? "TIMEOUT" : "NETWORK", detail: timeout ? "request timed out" : "network error", retryable: true, attempts: attempt };
    }
    if (attempt < maxAttempts) await sleep(waitMs);
  }
  return last;
}
