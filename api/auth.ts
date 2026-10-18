import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { getAuth } from "../src/server/auth.js";
import { cloudConfigured } from "../src/server/database.js";
import { json, safeFailure } from "../src/server/http.js";

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (!cloudConfigured()) return json(response, 503, { error: "El acceso compartido aún no está configurado." });
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const routedPath = url.searchParams.get("authPath");
    if (routedPath) {
      url.searchParams.delete("authPath");
      request.url = `/api/auth/${routedPath}${url.search}`;
    }
    await toNodeHandler(getAuth())(request, response);
  }
  catch (error) { safeFailure(response, error); }
}
