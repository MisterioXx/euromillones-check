import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppState } from "../types.js";
import { validateState } from "../lib/validation.js";
import { getPool, transaction } from "./database.js";
import { HttpError } from "./http.js";

export type WorkspaceRow = {
  id: string; name: string; owner_id: string; state: AppState; revision: number;
  background_enabled: boolean; updated_at: Date; last_checked_at: Date | null;
  lease_until?: Date | null; lease_token?: string | null;
};

export function snapshot(row: WorkspaceRow, userId: string) {
  return { id: row.id, name: row.name, state: validateState(row.state), revision: row.revision,
    backgroundEnabled: row.background_enabled, updatedAt: row.updated_at.toISOString(),
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null, isOwner: row.owner_id === userId };
}

export async function findWorkspace(userId: string): Promise<WorkspaceRow | undefined> {
  const result = await getPool().query<WorkspaceRow>(
    "SELECT w.* FROM ec_workspaces w JOIN ec_members m ON m.workspace_id=w.id WHERE m.user_id=$1", [userId],
  );
  return result.rows[0];
}

export function validatedCopy(value: unknown): AppState {
  try { return validateState(value); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Copia no válida."); }
}

export async function createWorkspace(userId: string, input: unknown, enabled: boolean): Promise<WorkspaceRow> {
  const state = validatedCopy(input);
  return transaction(async (client) => {
    // Lock the authenticated account so two tabs cannot initialise two shared copies.
    const account = await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
    if (!account.rowCount) throw new HttpError(401, "La cuenta ya no está disponible. Inicia sesión de nuevo.");
    const existing = await client.query("SELECT 1 FROM ec_members WHERE user_id=$1", [userId]);
    if (existing.rowCount) throw new HttpError(409, "Ya tienes una copia compartida. Ábrela antes de importar otros datos.");
    const id = randomUUID();
    const result = await client.query<WorkspaceRow>(
      "INSERT INTO ec_workspaces(id,name,owner_id,state,background_enabled) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, "EuroControl", userId, JSON.stringify(state), enabled],
    );
    await client.query("INSERT INTO ec_members(workspace_id,user_id) VALUES($1,$2)", [id, userId]);
    // Keep the submitted, validated original as well as the normalized working copy.
    await client.query("INSERT INTO ec_snapshots(workspace_id,revision,state,actor,reason) VALUES($1,1,$2,$3,'import')", [id, JSON.stringify(input), userId]);
    return result.rows[0];
  });
}

export type ScheduledSaveOptions = { leaseToken: string; checkedAt: Date; deadline?: number };

function requireTimeRemaining(deadline?: number): number {
  const remaining = deadline === undefined ? 15_000 : Math.floor(deadline - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new HttpError(409, "Se ha agotado el tiempo de esta comprobación. La copia existente se conserva.");
  return Math.max(1, Math.min(15_000, remaining));
}

async function saveWorkspaceInternal(id: string, input: unknown, revision: unknown, actor: string, scheduled?: ScheduledSaveOptions): Promise<WorkspaceRow> {
  const state = validatedCopy(input);
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new HttpError(400, "Falta la versión de la copia que estás editando.");
  if (scheduled && (!scheduled.leaseToken || !Number.isFinite(scheduled.checkedAt.getTime()))) throw new HttpError(400, "La comprobación programada no tiene una autorización válida.");
  requireTimeRemaining(scheduled?.deadline);
  return transaction(async (client) => {
    async function boundQueryTime() {
      const milliseconds = requireTimeRemaining(scheduled?.deadline);
      await client.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)", [`${milliseconds}ms`]);
    }
    await boundQueryTime();
    const current = scheduled
      ? (await client.query<WorkspaceRow>("SELECT * FROM ec_workspaces WHERE id=$1 FOR UPDATE", [id])).rows[0]
      : (await client.query<WorkspaceRow>("SELECT w.* FROM ec_workspaces w JOIN ec_members m ON m.workspace_id=w.id WHERE w.id=$1 AND m.user_id=$2 FOR UPDATE OF w", [id, actor])).rows[0];
    if (!current) throw new HttpError(404, "No hay una copia compartida accesible para esta cuenta.");
    if (current.revision !== revision) throw new HttpError(409, "Otro dispositivo o la comprobación automática ha actualizado la copia. Se conserva tu versión local; descarga ambas copias antes de resolver los cambios.");
    if (scheduled && (!current.background_enabled || current.lease_token !== scheduled.leaseToken || !current.lease_until || current.lease_until.getTime() <= Date.now())) {
      throw new HttpError(409, "La autorización de esta comprobación ha caducado o se ha desactivado. Se conserva la copia actual.");
    }
    await boundQueryTime();
    await client.query("INSERT INTO ec_snapshots(workspace_id,revision,state,actor,reason) VALUES($1,$2,$3,$4,$5)",
      [id, current.revision, JSON.stringify(current.state), actor, scheduled ? "automatic" : "edit"]);
    await boundQueryTime();
    const result = scheduled
      ? await client.query<WorkspaceRow>(
        "UPDATE ec_workspaces SET state=$2,revision=revision+1,updated_at=now(),last_checked_at=$3 WHERE id=$1 AND lease_token=$4 AND lease_until>clock_timestamp() AND background_enabled=true RETURNING *",
        [id, JSON.stringify(state), scheduled.checkedAt, scheduled.leaseToken],
      )
      : await client.query<WorkspaceRow>("UPDATE ec_workspaces SET state=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(state)]);
    if (!result.rowCount) throw new HttpError(409, "La comprobación perdió su autorización antes de guardar. Se conserva la copia actual.");
    await boundQueryTime();
    // Keep the original migration forever, plus the most recent 30 pre-change copies.
    await client.query("DELETE FROM ec_snapshots WHERE workspace_id=$1 AND reason<>'import' AND id NOT IN (SELECT id FROM ec_snapshots WHERE workspace_id=$1 AND reason<>'import' ORDER BY id DESC LIMIT 30)", [id]);
    requireTimeRemaining(scheduled?.deadline);
    return result.rows[0];
  }, scheduled?.deadline);
}

/** Membership is enforced here, not just at the HTTP layer. */
export async function saveWorkspace(id: string, input: unknown, revision: unknown, userId: string): Promise<WorkspaceRow> {
  return saveWorkspaceInternal(id, input, revision, userId);
}

/** Separate capability for the authenticated scheduler; a member ID can never impersonate it. */
export async function saveWorkspaceFromCron(id: string, input: unknown, revision: unknown, options: ScheduledSaveOptions): Promise<WorkspaceRow> {
  return saveWorkspaceInternal(id, input, revision, "cron", options);
}

type BackupRow = { id: string; revision: number; actor: string; reason: string; created_at: Date; state?: unknown };
export type WorkspaceBackup = { id: string; revision: number; actor: string; reason: string; createdAt: string };

function backupMetadata(row: BackupRow): WorkspaceBackup {
  return { id: String(row.id), revision: row.revision, actor: row.actor, reason: row.reason, createdAt: row.created_at.toISOString() };
}

export async function listWorkspaceBackups(userId: string): Promise<WorkspaceBackup[]> {
  const rows = await getPool().query<BackupRow>(
    "SELECT s.id,s.revision,s.actor,s.reason,s.created_at FROM ec_snapshots s JOIN ec_members m ON m.workspace_id=s.workspace_id WHERE m.user_id=$1 ORDER BY s.id DESC LIMIT 100", [userId],
  );
  return rows.rows.map(backupMetadata);
}

export async function readWorkspaceBackup(userId: string, id: unknown): Promise<{ state: AppState; backup: WorkspaceBackup }> {
  if (typeof id !== "string" || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) throw new HttpError(400, "Identificador de copia no válido.");
  const row = (await getPool().query<BackupRow>(
    "SELECT s.* FROM ec_snapshots s JOIN ec_members m ON m.workspace_id=s.workspace_id WHERE s.id=$1 AND m.user_id=$2", [id, userId],
  )).rows[0];
  if (!row) throw new HttpError(404, "La copia no existe o no pertenece a tu copia compartida.");
  return { state: validatedCopy(row.state), backup: backupMetadata(row) };
}

export async function createInvite(userId: string): Promise<string> {
  const workspace = await findWorkspace(userId);
  if (!workspace || workspace.owner_id !== userId) throw new HttpError(403, "Solo quien creó la copia compartida puede generar invitaciones.");
  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await getPool().query("INSERT INTO ec_invites(token_hash,workspace_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hash, workspace.id]);
  return token;
}

export async function joinWorkspace(userId: string, token: unknown): Promise<WorkspaceRow> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw new HttpError(400, "Código de invitación no válido.");
  return transaction(async (client) => {
    const account = await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId]);
    if (!account.rowCount) throw new HttpError(401, "La cuenta ya no está disponible. Inicia sesión de nuevo.");
    const existing = await client.query("SELECT 1 FROM ec_members WHERE user_id=$1", [userId]);
    if (existing.rowCount) throw new HttpError(409, "Esta cuenta ya tiene una copia compartida. No se sustituirán sus datos.");
    const hash = createHash("sha256").update(token).digest("hex");
    const invite = (await client.query<{workspace_id: string}>("SELECT workspace_id FROM ec_invites WHERE token_hash=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE", [hash])).rows[0];
    if (!invite) throw new HttpError(400, "La invitación ha caducado o ya se ha utilizado.");
    await client.query("INSERT INTO ec_members(workspace_id,user_id) VALUES($1,$2)", [invite.workspace_id, userId]);
    await client.query("UPDATE ec_invites SET used_at=now() WHERE token_hash=$1", [hash]);
    return (await client.query<WorkspaceRow>("SELECT * FROM ec_workspaces WHERE id=$1", [invite.workspace_id])).rows[0];
  });
}
