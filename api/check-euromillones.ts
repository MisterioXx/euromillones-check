type VercelRequest = Record<string, unknown>;

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

import { fetchEuromillonesResult } from "../src/server/checkEuromillones";

export default async function handler(_request: VercelRequest, response: VercelResponse) {
  const url = new URL(String((_request as { url?: string }).url ?? "/"), "http://localhost");
  const date = url.searchParams.get("date") ?? undefined;
  const result = await fetchEuromillonesResult(date);
  response.status(result.ok ? 200 : 502).json(result);
}
