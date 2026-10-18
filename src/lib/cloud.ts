import type { AppState } from "../types.js";

export type CloudSnapshot = { id: string; name: string; state: AppState; revision: number; backgroundEnabled: boolean; updatedAt: string; lastCheckedAt: string | null; isOwner: boolean };
export class CloudError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function cloudRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  let result;
  try { result = await response.json(); } catch { throw new CloudError(response.status, "El servidor no ha devuelto una respuesta válida. Tu copia local se conserva."); }
  if (!response.ok) throw new CloudError(response.status, result.error?.message ?? result.error ?? result.message ?? "No se ha podido completar la operación.");
  return result as T;
}
