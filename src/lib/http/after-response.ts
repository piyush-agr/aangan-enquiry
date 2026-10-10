import { after } from "next/server";

/** Pending background jobs, exposed so tests can await completion. */
export const pendingJobs = new Set<Promise<unknown>>();

/**
 * Run work after the HTTP response is sent (Next.js `after`). Outside a Next request scope (unit tests,
 * scripts) it falls back to an un-awaited promise tracked in `pendingJobs`.
 */
export function runAfterResponse(fn: () => Promise<unknown>) {
  try {
    after(fn);
  } catch {
    const p = fn().finally(() => pendingJobs.delete(p));
    pendingJobs.add(p);
  }
}

export async function drainPendingJobs() {
  while (pendingJobs.size) await Promise.allSettled([...pendingJobs]);
}
