import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { emptyCronCounters, runScheduledChecks, type CronCounters } from "../src/server/cron.js";
import { json } from "../src/server/http.js";

export function validCronAuthorization(header: unknown, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || typeof header !== "string" || header.length > 1024) return false;
  // Hash to equal-sized buffers so timingSafeEqual also covers different header lengths.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export function createCronHandler(options: {
  secret?: () => string | undefined;
  configured?: () => boolean;
  run?: () => Promise<CronCounters>;
} = {}) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return json(response, 405, { error: "Método no permitido." });
    }
    const secret = (options.secret ?? (() => process.env.CRON_SECRET))();
    if (!validCronAuthorization(request.headers.authorization, secret)) return json(response, 401, { error: "No autorizado." });
    if (!(options.configured ?? (() => Boolean(process.env.DATABASE_URL)))()) {
      return json(response, 503, { ...emptyCronCounters(), workspacesFailed: 1 });
    }
    try {
      return json(response, 200, await (options.run ?? runScheduledChecks)());
    } catch {
      console.error("EuroControl cron: no se pudo acceder al almacenamiento compartido.");
      return json(response, 503, { ...emptyCronCounters(), workspacesFailed: 1 });
    }
  };
}

export default createCronHandler();
