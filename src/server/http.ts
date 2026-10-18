import type { IncomingMessage, ServerResponse } from "node:http";
import { trustedOrigins } from "./auth.js";

export type ApiRequest = IncomingMessage & { body?: unknown };
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

export function requireSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin || !trustedOrigins().includes(origin)) throw new HttpError(403, "Origen de la solicitud no permitido.");
}

export async function bodyJson(request: ApiRequest): Promise<Record<string, unknown>> {
  let input = request.body;
  if (input === undefined) {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > 1_000_000) throw new HttpError(413, "La copia supera el límite de 1 MB.");
      chunks.push(bytes);
    }
    input = Buffer.concat(chunks).toString("utf8");
  }
  let serialized: string;
  try {
    serialized = typeof input === "string" ? input : JSON.stringify(input);
    if (typeof serialized !== "string") throw new Error();
  } catch { throw new HttpError(400, "La solicitud no contiene un objeto JSON válido."); }
  if (Buffer.byteLength(serialized) > 1_000_000) {
    throw new HttpError(413, "La copia supera el límite de 1 MB.");
  }
  try {
    const value = typeof input === "string" ? JSON.parse(input) : input;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "La solicitud no contiene un objeto JSON válido."); }
}

export function safeFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) json(response, error.status, { error: error.message });
  else {
    // Do not leak credentials, SQL parameters, or personal state to client/logs.
    console.error("EuroControl: operación de almacenamiento fallida.");
    json(response, 503, { error: "No se ha podido guardar o recuperar la copia compartida. Tu copia local se conserva; vuelve a intentarlo." });
  }
}
