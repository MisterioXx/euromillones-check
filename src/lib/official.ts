import type { OfficialCheckResponse } from "../types";

export async function checkOfficialResults(date?: string): Promise<OfficialCheckResponse> {
  const path = date
    ? `/api/check-euromillones?date=${encodeURIComponent(date)}`
    : "/api/check-euromillones";
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const raw = await response.text();

  let payload: OfficialCheckResponse;
  try {
    payload = JSON.parse(raw) as OfficialCheckResponse;
  } catch {
    throw new Error(
      `La API de comprobacion no devolvio JSON valido. Respuesta inicial: ${raw.slice(0, 80)}`,
    );
  }

  return payload;
}
