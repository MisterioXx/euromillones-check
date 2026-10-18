import type { ServerResponse } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../src/server/auth.js";
import { cloudConfigured, getPool } from "../src/server/database.js";
import { bodyJson, HttpError, json, requireSameOrigin, safeFailure, type ApiRequest } from "../src/server/http.js";
import { createInvite, createWorkspace, findWorkspace, joinWorkspace, listWorkspaceBackups, readWorkspaceBackup, saveWorkspace, snapshot } from "../src/server/workspaces.js";

export default async function handler(request: ApiRequest, response: ServerResponse) {
  const params = new URL(request.url ?? "/", "http://localhost").searchParams;
  const action = params.get("action");
  if (request.method === "GET" && action === "status") {
    return json(response, 200, { configured: cloudConfigured(), scheduler: process.env.VERCEL_ENV === "production" ? "daily" : "preview" });
  }
  if (!cloudConfigured()) return json(response, 503, { error: "La copia compartida aún no está configurada. Tus datos locales se conservan." });
  try {
    const session = await getAuth().api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new HttpError(401, "Inicia sesión para acceder a la copia compartida.");
    const userId = session.user.id;
    if (request.method === "GET") {
      if (action === "backups") return json(response, 200, { backups: await listWorkspaceBackups(userId) });
      if (action === "backup") return json(response, 200, await readWorkspaceBackup(userId, params.get("id")));
      if (action) throw new HttpError(404, "Acción no disponible.");
      const workspace = await findWorkspace(userId);
      return json(response, 200, { workspace: workspace ? snapshot(workspace, userId) : null });
    }
    if (request.method !== "POST" && request.method !== "PUT") throw new HttpError(405, "Método no permitido.");
    requireSameOrigin(request);
    const body = await bodyJson(request);
    if (request.method === "POST" && (action === "create" || action === "join") && body.expectedUserId !== userId) {
      throw new HttpError(409, "La cuenta de la sesión ha cambiado. Se conserva tu copia local. Recarga la aplicación antes de crear o abrir una copia compartida.");
    }
    if (request.method === "POST" && action === "create") {
      if (body.confirmMigration !== true) throw new HttpError(400, "Revisa y confirma la copia antes de migrar.");
      const workspace = await createWorkspace(userId, body.state, body.backgroundEnabled === true);
      return json(response, 201, { workspace: snapshot(workspace, userId) });
    }
    if (request.method === "POST" && action === "join") {
      return json(response, 200, { workspace: snapshot(await joinWorkspace(userId, body.token), userId) });
    }
    const workspace = await findWorkspace(userId);
    if (!workspace) throw new HttpError(404, "No hay una copia compartida vinculada a esta cuenta.");
    // A different tab may have changed the session cookie. A matching revision alone
    // must never allow an old tab to write its state into the new account's workspace.
    if (body.workspaceId !== workspace.id) throw new HttpError(409, "La sesión o la copia compartida ha cambiado. Se conserva tu copia local. Recarga la aplicación y revisa la conexión antes de continuar.");
    if (request.method === "POST" && action === "invite") return json(response, 201, { token: await createInvite(userId) });
    if (request.method === "POST" && action === "schedule") {
      if (workspace.owner_id !== userId) throw new HttpError(403, "Solo quien creó la copia compartida puede cambiar la comprobación diaria.");
      if (typeof body.enabled !== "boolean") throw new HttpError(400, "Indica si quieres activar la comprobación diaria.");
      await getPool().query("UPDATE ec_workspaces SET background_enabled=$2 WHERE id=$1", [workspace.id, body.enabled]);
      return json(response, 200, { enabled: body.enabled });
    }
    if (request.method === "PUT" && !action) {
      return json(response, 200, { workspace: snapshot(await saveWorkspace(workspace.id, body.state, body.revision, userId), userId) });
    }
    throw new HttpError(404, "Acción no disponible.");
  } catch (error) { safeFailure(response, error); }
}
