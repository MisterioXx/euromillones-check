import type { AppState, OfficialCheckResponse } from "../types.js";
import { applyCheckResult, getPendingDraws } from "../lib/reconciliation.js";
import { fetchEuromillonesResult } from "./checkEuromillones.js";

export type BatchSummary = {
  state: AppState;
  attempted: number;
  failed: number;
  remaining: number;
};

/** The same reconciliation rules apply to interactive checks and scheduled checks. */
export async function checkStateBatch(
  initial: AppState,
  options: {
    limit?: number;
    deadline?: number;
    now?: Date;
    check?: (date: string) => Promise<OfficialCheckResponse>;
  } = {},
): Promise<BatchSummary> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const check = options.check ?? fetchEuromillonesResult;
  // Failed dates cannot monopolise the next batch. Unattempted draws come first.
  const pending = getPendingDraws(initial, now).sort((a, b) =>
    (a.lastAttemptAt ?? "").localeCompare(b.lastAttemptAt ?? "") || b.date.localeCompare(a.date),
  );
  let state = initial;
  let attempted = 0;
  let failed = 0;
  for (const draw of pending.slice(0, limit)) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) break;
    let result: OfficialCheckResponse;
    try {
      result = await check(draw.date);
    } catch {
      result = {
        ok: false,
        requestedDate: draw.date,
        date: draw.date,
        source: "",
        fetchedAt: new Date().toISOString(),
        message: "No se pudo conectar con las fuentes de resultados. Se volverá a intentar.",
        errorCode: "source_unavailable",
      };
    }
    state = applyCheckResult(state, draw.id, result);
    attempted += 1;
    if (!result.ok) failed += 1;
  }
  return { state, attempted, failed, remaining: getPendingDraws(state, now).length };
}
