import type { OfficialCheckResponse } from "../types.js";

export async function checkOfficialResults(date?: string): Promise<OfficialCheckResponse> {
  const path = date
    ? `/api/check-euromillones?date=${encodeURIComponent(date)}`
    : "/api/check-euromillones";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let raw: string;
  try {
    const response = await fetch(path, {
      method: "GET", headers: { Accept: "application/json" }, signal: controller.signal,
    });
    raw = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("La comprobación ha tardado demasiado. Puedes volver a intentarlo.");
    throw error;
  } finally { clearTimeout(timeout); }

  let payload: OfficialCheckResponse;
  try {
    payload = JSON.parse(raw) as OfficialCheckResponse;
  } catch {
    throw new Error(
      `La API de comprobacion no devolvio JSON valido. Respuesta inicial: ${raw.slice(0, 80)}`,
    );
  }

  if (!payload || typeof payload.ok !== "boolean" || typeof payload.source !== "string" || typeof payload.fetchedAt !== "string") {
    throw new Error("La API devolvió una respuesta de comprobación incompleta.");
  }
  if (payload.ok && date && payload.date !== date) throw new Error("La fuente devolvió un sorteo distinto del solicitado.");
  return payload;
}
