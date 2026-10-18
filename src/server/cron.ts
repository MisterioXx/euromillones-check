import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { AppState } from "../types.js";
import { validateState } from "../lib/validation.js";
import { checkStateBatch, type BatchSummary } from "./checkBatch.js";
import { createEuromillonesChecker } from "./checkEuromillones.js";
import { getPool } from "./database.js";
import { HttpError } from "./http.js";
import { saveWorkspaceFromCron, type WorkspaceRow } from "./workspaces.js";

const TOTAL_BUDGET_MS = 45_000;
const SAVE_RESERVE_MS = 15_000;
const RELEASE_RESERVE_MS = 5_000;
const LEASE_SECONDS = 120;

export type CronCounters = {
  workspacesChecked: number;
  workspacesUpdated: number;
  workspacesSkipped: number;
  workspacesFailed: number;
  conflicts: number;
  drawsAttempted: number;
  drawsFailed: number;
  drawsRemaining: number;
  deadlineReached: number;
};

export function emptyCronCounters(): CronCounters {
  return { workspacesChecked: 0, workspacesUpdated: 0, workspacesSkipped: 0, workspacesFailed: 0,
    conflicts: 0, drawsAttempted: 0, drawsFailed: 0, drawsRemaining: 0, deadlineReached: 0 };
}

export type CronStore = {
  list(deadline: number): Promise<string[]>;
  claim(id: string, token: string, deadline: number): Promise<WorkspaceRow | undefined>;
  save(workspace: WorkspaceRow, state: AppState, token: string, checkedAt: Date, deadline: number): Promise<void>;
  complete(id: string, token: string, checkedAt: Date, deadline: number): Promise<void>;
  release(id: string, token: string, deadline: number): Promise<void>;
};

/** Short lease operations are bounded, including time waiting for a pooled connection. */
async function query<T extends pg.QueryResultRow>(text: string, values: unknown[], deadline: number): Promise<pg.QueryResult<T>> {
  const timeout = Math.min(5_000, deadline - Date.now());
  if (timeout <= 0) throw new HttpError(503, "Presupuesto de comprobación agotado.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config: pg.QueryConfig & { query_timeout: number } = { text, values, query_timeout: timeout };
    return await Promise.race([
      getPool().query<T>(config),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new HttpError(503, "Almacenamiento no disponible a tiempo.")), timeout); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export function createCronStore(): CronStore {
  return {
    async list(deadline) {
      const result = await query<{ id: string }>(
        "SELECT id FROM ec_workspaces WHERE background_enabled=true AND (lease_until IS NULL OR lease_until<=now()) ORDER BY last_checked_at ASC NULLS FIRST,id LIMIT 50", [], deadline,
      );
      return result.rows.map((row) => row.id);
    },
    async claim(id, token, deadline) {
      // The conditional UPDATE is atomic. A second invocation cannot acquire the same live lease.
      const result = await query<WorkspaceRow>(
        "UPDATE ec_workspaces SET lease_token=$2,lease_until=now()+($3 * interval '1 second') WHERE id=$1 AND background_enabled=true AND (lease_until IS NULL OR lease_until<=now()) AND now()<to_timestamp($4 / 1000.0) RETURNING *",
        [id, token, LEASE_SECONDS, deadline], deadline,
      );
      return result.rows[0];
    },
    async save(workspace, state, token, checkedAt, deadline) {
      await saveWorkspaceFromCron(workspace.id, state, workspace.revision, { leaseToken: token, checkedAt, deadline });
    },
    async complete(id, token, checkedAt, deadline) {
      // No pending draws: update scheduling metadata without creating an unnecessary state revision.
      const result = await query(
        "UPDATE ec_workspaces SET last_checked_at=$3 WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND background_enabled=true AND now()<to_timestamp($4 / 1000.0)",
        [id, token, checkedAt, deadline], deadline,
      );
      if (!result.rowCount) throw new HttpError(409, "La comprobación ya no conserva su reserva.");
    },
    async release(id, token, deadline) {
      // An expired runner must never clear a newer runner's lease.
      await query("UPDATE ec_workspaces SET lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2", [id, token], deadline);
    },
  };
}

export async function runScheduledChecks(options: {
  store?: CronStore;
  now?: () => number;
  token?: () => string;
  batch?: typeof checkStateBatch;
  checker?: ReturnType<typeof createEuromillonesChecker>;
  budgetMs?: number;
} = {}): Promise<CronCounters> {
  const now = options.now ?? Date.now;
  const started = now();
  const budget = Math.max(1, Math.min(TOTAL_BUDGET_MS, options.budgetMs ?? TOTAL_BUDGET_MS));
  const deadline = started + budget;
  const checkDeadline = deadline - Math.min(SAVE_RESERVE_MS, budget / 3);
  const saveDeadline = deadline - Math.min(RELEASE_RESERVE_MS, budget / 9);
  const store = options.store ?? createCronStore();
  const batch = options.batch ?? checkStateBatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, checkDeadline - now()));
  const checker = options.checker ?? createEuromillonesChecker({ signal: controller.signal });
  const counters = emptyCronCounters();
  try {
    const ids = await store.list(deadline);
    for (const id of ids) {
      if (now() >= checkDeadline) { counters.deadlineReached = 1; break; }
      const token = (options.token ?? randomUUID)();
      let claimed = false;
      try {
        const workspace = await store.claim(id, token, deadline);
        if (!workspace) { counters.workspacesSkipped++; continue; }
        claimed = true;
        if (now() >= checkDeadline) { counters.deadlineReached = 1; break; }
        const initial = validateState(workspace.state);
        const result: BatchSummary = await batch(initial, { limit: 12, deadline: checkDeadline, now: new Date(now()), check: checker });
        counters.drawsAttempted += result.attempted;
        counters.drawsFailed += result.failed;
        counters.drawsRemaining += result.remaining;
        if (now() >= checkDeadline) counters.deadlineReached = 1;
        if (now() >= saveDeadline) { counters.deadlineReached = 1; break; }
        if (result.attempted > 0) {
          // saveWorkspaceFromCron atomically checks revision + lease + background_enabled.
          await store.save(workspace, result.state, token, new Date(now()), saveDeadline);
          counters.workspacesUpdated++;
        } else if (!result.remaining) {
          await store.complete(id, token, new Date(now()), saveDeadline);
        } else continue;
        counters.workspacesChecked++;
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) counters.conflicts++;
        else counters.workspacesFailed++;
        // Keep processing other workspaces; never emit personal data, credentials or SQL errors.
        console.error("EuroControl cron: no se pudo completar una copia compartida.");
      } finally {
        if (claimed && now() < deadline) {
          try { await store.release(id, token, deadline); }
          catch { console.error("EuroControl cron: la reserva caducará automáticamente."); }
        }
      }
    }
    if (now() >= deadline) counters.deadlineReached = 1;
    return counters;
  } finally { clearTimeout(timer); controller.abort(); }
}
