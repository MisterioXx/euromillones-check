import { fetchEuromillonesResult } from "../src/server/checkEuromillones.js";

type Request = { method?: string; url?: string };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

export default async function handler(request: Request, response: Response) {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, message: "Método no permitido." });
    return;
  }
  const url = new URL(request.url ?? "/", "https://euromillones.local");
  const result = await fetchEuromillonesResult(url.searchParams.get("date") ?? undefined);
  // Public draw results only. Failures and incomplete payouts are not CDN-cached.
  response.setHeader("Cache-Control", result.ok && result.prizesVerified
    ? "public, s-maxage=300, stale-while-revalidate=60" : "no-store");
  const status = result.ok ? 200 : result.errorCode === "invalid_date" ? 400 : result.errorCode === "not_published" ? 404 : 502;
  response.status(status).json(result);
}
