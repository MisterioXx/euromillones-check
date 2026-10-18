import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEuromillonesChecker as newChecker, parseAngelitaHtml, parseComprobarHtml, matchingPublicResults, parseRtveArticle, parseRtveHtml, parseSelaeArticle, parseSelaePayload, validCombination, validDrawDate } from "../src/server/checkEuromillones.ts";
import handler from "../api/check-euromillones.ts";
import { initialState } from "../src/lib/seed.js";
import { applyCheckResult } from "../src/lib/reconciliation.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const historical = fixture("selae-2026-05-05.json");
const recent = fixture("selae-2026-10-16.json");
const officialArticle = fixture("selae-2026-05-05.html");
const rtve = fixture("rtve-2026-10-16.html");
const rtveArticle = fixture("rtve-2026-05-05-article.html");
const now = () => new Date("2026-10-18T12:00:00Z");
const response = (body: string, status = 200) => new Response(body, { status });
const payload = () => JSON.parse(historical);
const createEuromillonesChecker = (options: Parameters<typeof newChecker>[0] = {}) => newChecker({ sourceIntervalMs: 0, ...options });

test("official historical JSON preserves cents and parses one-decimal payouts", () => {
  const result = parseSelaePayload(payload(), "2026-05-05")!;
  assert.deepEqual(result.numbers, [3, 4, 8, 20, 31]);
  assert.deepEqual(result.stars, [6, 8]);
  assert.equal(result.prizes.find((row) => row.category === "13a categoria")?.amount, 3.75);
  assert.equal(result.prizes.find((row) => row.category === "6a categoria")?.amount, 46.5);
  assert.ok(!result.prizes.some((row) => row.category === "1a categoria"));
  assert.equal(parseSelaePayload(JSON.parse(recent), "2026-10-16")?.prizes.at(-1)?.amount, 3.67);
});

test("historical SELAE HTML agrees with JSON despite its unusual decimal formatting", () => {
  assert.deepEqual(parseSelaeArticle(officialArticle, "2026-05-05"), parseSelaePayload(payload(), "2026-05-05"));
  assert.throws(() => parseSelaeArticle(officialArticle, "2026-05-08"), /fecha/);
});

test("numbers and stars remain separate even when their values overlap", () => {
  const data = payload(); data[0].combinacion = "01 - 02 - 03 - 04 - 05 - 01 - 02";
  const result = parseSelaePayload(data, "2026-05-05");
  assert.deepEqual(result?.stars, [1, 2]);
});

test("reject wrong dates, games, duplicate numbers and inconsistent payout categories", () => {
  assert.throws(() => parseSelaePayload(payload(), "2026-05-08"), /fecha/);
  const game = payload(); game[0].game_id = "BONO";
  assert.throws(() => parseSelaePayload(game, "2026-05-05"), /juego/);
  const duplicate = payload(); duplicate[0].combinacion = "01 - 01 - 03 - 04 - 05 - 01 - 02";
  assert.throws(() => parseSelaePayload(duplicate, "2026-05-05"), /combinación/);
  const badCategory = payload(); badCategory[0].escrutinio[12].tipo = "13ª 5 + 2";
  assert.throws(() => parseSelaePayload(badCategory, "2026-05-05"), /categoría/);
  const duplicates = payload(); duplicates[0].escrutinio.push(duplicates[0].escrutinio[12]);
  assert.throws(() => parseSelaePayload(duplicates, "2026-05-05"), /duplicadas/);
});

test("missing payouts stay absent; malformed amounts never turn into zero", () => {
  const incomplete = payload(); delete incomplete[0].escrutinio;
  assert.deepEqual(parseSelaePayload(incomplete, "2026-05-05")?.prizes, []);
  const malformed = payload(); malformed[0].escrutinio[12].premio = "desconocido";
  assert.throws(() => parseSelaePayload(malformed, "2026-05-05"), /cuota/);
  assert.throws(() => parseSelaePayload({ ok: true }, "2026-05-05"), /lista/);
});

test("RTVE combination is accepted but its truncated payout table is never credited", () => {
  const parsed = parseRtveHtml(rtve, "2026-10-16")!;
  assert.deepEqual(parsed.numbers, [7, 15, 16, 22, 35]);
  assert.deepEqual(parsed.stars, [4, 6]);
  assert.deepEqual(parsed.prizes, []);
  assert.equal(parseRtveHtml(rtve, "2026-05-05"), undefined);
  assert.throws(() => parseRtveHtml(rtve.replace(">07</strong>", ">99</strong>"), "2026-10-16"), /combinación/);
});

test("RTVE historical article provides a date-verified combination outside its current widget", () => {
  const parsed = parseRtveArticle(rtveArticle, "2026-05-05");
  assert.deepEqual(parsed.numbers, [3, 4, 8, 20, 31]);
  assert.deepEqual(parsed.stars, [6, 8]);
  assert.deepEqual(parsed.prizes, []);
  assert.throws(() => parseRtveArticle(rtveArticle, "2026-05-08"), /fecha/);
});

test("official success uses one request, deduplicates concurrent checks and isolates cached data", async () => {
  let calls = 0;
  const check = createEuromillonesChecker({ now, fetchImpl: async () => { calls++; return response(historical); } });
  const [first, second] = await Promise.all([check("2026-05-05"), check("2026-05-05")]);
  assert.equal(calls, 1);
  assert.equal(first.prizesVerified, true);
  first.numbers![0] = 49;
  assert.equal(second.numbers![0], 3);
  assert.equal((await check("2026-05-05")).numbers![0], 3);
  assert.equal(calls, 1);
});

test("transient server failure is retried once before trying alternate sources", async () => {
  let calls = 0;
  const check = createEuromillonesChecker({ now, retryDelayMs: 0, fetchImpl: async () => response(++calls === 1 ? "Unavailable" : historical, calls === 1 ? 503 : 200) });
  assert.equal((await check("2026-05-05")).ok, true);
  assert.equal(calls, 2);
});

test("blocked JSON falls back to the historical official article with exact amounts", async () => {
  const urls: string[] = [];
  const check = createEuromillonesChecker({ now, fetchImpl: async (input) => {
    const url = String(input); urls.push(url);
    return url.includes("buscadorSorteos") ? response("Blocked", 403) : response(officialArticle);
  } });
  const result = await check("2026-05-05");
  assert.equal(result.ok, true);
  assert.equal(result.prizesVerified, true);
  assert.equal(result.prizes?.at(-1)?.amount, 3.75);
  assert.equal(urls.length, 2);
});

test("RTVE archive link is followed when the requested date left the homepage results", async () => {
  const link = "https://www.rtve.es/rtve/20260506/sorteo-bonoloto-euromillones-del-martes-5-mayo/17054400.shtml";
  const check = createEuromillonesChecker({ now, fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes("loteriasyapuestas")) return response("Blocked", 403);
    return response(url === link ? rtveArticle : `<a href="${link}">Archivo</a>${rtve}`);
  } });
  const result = await check("2026-05-05");
  assert.equal(result.source, link);
  assert.equal(result.ok, true);
  assert.equal(result.prizesVerified, false);
  assert.deepEqual(result.prizes, []);
  assert.match(result.rawSnippet!, /SELAE JSON: HTTP 403/);
  assert.match(result.rawSnippet!, /SELAE escrutinio: HTTP 403/);
  assert.match(result.rawSnippet!, /SELAE resultado: HTTP 403/);
});

test("timeout aborts a provider and fallback still works", async () => {
  let aborted = 0;
  const check = createEuromillonesChecker({ now, timeoutMs: 5, retryDelayMs: 0, fetchImpl: async (input, init) => {
    if (String(input).includes("buscadorSorteos")) return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted++; reject(new DOMException("Timeout", "AbortError")); });
    });
    return response(officialArticle);
  } });
  assert.equal((await check("2026-05-05")).ok, true);
  assert.equal(aborted, 2);
});

test("partial results expire quickly so late payouts can be recovered", async () => {
  let time = now().getTime(); let published = false;
  const incomplete = payload(); incomplete[0].escrutinio = [];
  const check = createEuromillonesChecker({ now: () => new Date(time), fetchImpl: async (input) => {
    return String(input).includes("buscadorSorteos") ? response(published ? historical : JSON.stringify(incomplete)) : response("Missing", 404);
  } });
  assert.deepEqual((await check("2026-05-05")).prizes, []);
  published = true; time += 61_000;
  assert.equal((await check("2026-05-05")).prizes?.at(-1)?.amount, 3.75);
});

test("disagreement between official structured result and article prevents application", async () => {
  const wrong = payload(); wrong[0].combinacion = "01 - 02 - 03 - 04 - 05 - 01 - 02"; wrong[0].escrutinio = [];
  const check = createEuromillonesChecker({ now, fetchImpl: async (input) => response(String(input).includes("buscadorSorteos") ? JSON.stringify(wrong) : officialArticle) });
  const result = await check("2026-05-05");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "conflicting_sources");
});

test("invalid dates and future draws never issue external requests", async () => {
  let calls = 0;
  const check = createEuromillonesChecker({ now, fetchImpl: async () => { calls++; throw new Error("Unexpected request"); } });
  assert.equal((await check("2026-02-31")).errorCode, "invalid_date");
  assert.equal((await check("2026-10-18")).errorCode, "invalid_date");
  assert.equal((await check("2026-10-20")).errorCode, "not_published");
  assert.equal(calls, 0);
  assert.equal(validDrawDate("2026-05-05"), true);
  assert.equal(validCombination([7, 14, 17, 25, 33], [4, 4]), false);
});

test("unavailable sources return a useful failure with diagnostic details", async () => {
  const check = createEuromillonesChecker({ now, fetchImpl: async () => response("Blocked", 403) });
  const result = await check("2026-05-05");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "source_unavailable");
  assert.match(result.rawSnippet!, /HTTP 403/);
  assert.match(result.message!, /2026-05-05/);
});

test("latest draw uses Madrid time before and after 22:00 in summer and winter", async () => {
  for (const [instant, expectedDate] of [
    ["2026-10-20T19:30:00Z", "2026-10-16"], ["2026-10-20T20:30:00Z", "2026-10-20"],
    ["2026-11-24T20:30:00Z", "2026-11-20"], ["2026-11-24T21:30:00Z", "2026-11-24"],
  ]) {
    const check = createEuromillonesChecker({ now: () => new Date(instant), fetchImpl: async (input) => {
      const compact = new URL(String(input)).searchParams.get("fechaInicioInclusiva")!;
      const data = payload();
      data[0].fecha_sorteo = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)} 21:13:00`;
      return response(JSON.stringify(data));
    } });
    assert.equal((await check()).date, expectedDate);
  }
});

test("public API rejects writes and invalid dates without caching errors", async () => {
  const headers: Record<string, string> = {}; let status = 0; let body: any;
  const reply = { setHeader: (name: string, value: string) => { headers[name] = value; },
    status: (value: number) => { status = value; return reply; }, json: (value: unknown) => { body = value; } };
  await handler({ method: "POST", url: "/api/check-euromillones" }, reply);
  assert.equal(status, 405);
  assert.equal(headers.Allow, "GET");
  await handler({ method: "GET", url: "/api/check-euromillones?date=invalid" }, reply);
  assert.equal(status, 400);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(body.errorCode, "invalid_date");
});

test("a shared deadline aborts the current fetch without retrying or starting other providers", async () => {
  const controller = new AbortController(); let calls = 0;
  const check = createEuromillonesChecker({ now, signal: controller.signal, retryDelayMs: 0, fetchImpl: async (_input, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      controller.abort();
    });
  } });
  const result = await check("2026-05-05");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "source_unavailable");
  assert.equal(calls, 1);
});

test("both Spanish publications match complete official tables for historical and recent draws", () => {
  for (const [date, expected] of [["2026-05-05", 3.75], ["2026-10-13", 4.02], ["2026-10-16", 3.67]] as const) {
    const first = parseAngelitaHtml(fixture(`angelita-${date}.html`), date);
    const second = parseComprobarHtml(fixture(`comprobar-${date}.html`), date);
    assert.equal(matchingPublicResults(first, second), true);
    assert.equal(first.prizes.at(-1)?.amount, expected);
    if (date !== "2026-10-13") assert.equal(matchingPublicResults(first, parseSelaePayload(JSON.parse(fixture(`selae-${date}.json`)), date)!), true);
  }
});

test("public parsers reject a different date, malformed combination and incomplete or duplicate categories", () => {
  const date = "2026-10-16";
  const first = fixture(`angelita-${date}.html`);
  const second = fixture(`comprobar-${date}.html`);
  assert.throws(() => parseAngelitaHtml(first, "2026-10-13"), /fecha/);
  assert.throws(() => parseAngelitaHtml(first, "2026-10-06"), /fecha/);
  assert.throws(() => parseComprobarHtml(second, "2026-10-13"), /fecha/);
  assert.throws(() => parseAngelitaHtml(first.replace("<span>07</span>", "<span>99</span>"), date), /combinación/);
  assert.throws(() => parseComprobarHtml(second.replace('melate">07', 'melate">15'), date), /combinación/);
  assert.throws(() => parseAngelitaHtml(first.replace(/<tr><td>13ª[\s\S]*?<\/tr>/, ""), date), /13 categorías/);
  assert.throws(() => parseComprobarHtml(second.replace(/13ª\s+2\s+\+\s+0e/, "12ª 2 + 1e"), date), /duplicadas/);
  assert.throws(() => parseAngelitaHtml(first.replace("3,67 €", "3 €"), date), /céntimos/);
});

function publicChecker(first: string | number, second: string | number, official = 403) {
  return createEuromillonesChecker({ now, fetchImpl: async (input) => {
    const url = String(input);
    const value = url.includes("loteriaangelita.com") ? first : url.includes("comprobareuromillones.com") ? second : url.includes("rtve.es") ? rtve : official;
    return typeof value === "number" ? response("Unavailable", value) : response(value);
  } });
}

test("the complete corroborated table is verified and identifies both sources", async () => {
  const result = await publicChecker(fixture("angelita-2026-10-16.html"), fixture("comprobar-2026-10-16.html"))("2026-10-16");
  assert.equal(result.ok, true);
  assert.equal(result.prizesVerified, true);
  assert.equal(result.prizes?.at(-1)?.amount, 3.67);
  assert.match(result.source, /loteriaangelita\.com/);
  assert.match(result.prizeSource!, /comprobareuromillones\.com/);
  assert.match(result.sourceName!, /Lotería Angelita \+ ComprobarEuromillones/);
});

test("whole-euro payouts match Angelita's explicit cents for all eleven affected dates with SELAE unavailable", async () => {
  const cases = [
    ["2026-03-10", 1, 209527211, 3.77], ["2026-04-17", 7, 56, 4.23],
    ["2026-04-21", 1, 48175066, 4.25], ["2026-05-26", 5, 145, 3.95],
    ["2026-06-09", 1, 174984088, 3.99], ["2026-07-03", 1, 80220498, 3.73],
    ["2026-08-07", 1, 111058174, 4.33], ["2026-08-11", 4, 1491, 3.91],
    ["2026-09-11", 4, 1485, 3.96], ["2026-09-25", 1, 130000000, 3.8],
    ["2026-10-02", 1, 28871634, 3.45],
  ] as const;
  for (const [date, category, amount, lastAmount] of cases) {
    const result = await publicChecker(fixture(`angelita-${date}.html`), fixture(`comprobar-${date}.html`))(date);
    assert.equal(result.ok, true, date);
    assert.equal(result.prizesVerified, true, date);
    assert.equal(result.prizes?.find((row) => row.category === `${category}a categoria`)?.amount, amount, date);
    assert.equal(result.prizes?.at(-1)?.amount, lastAmount, date);
    assert.match(result.rawSnippet!, /SELAE JSON: HTTP 403/, date);
  }
  assert.equal(parseComprobarHtml(fixture("comprobar-2026-02-06.html"), "2026-02-06").prizes.find((row) => row.category === "8a categoria")?.amount, 14);
});

test("whole-euro support never accepts ambiguous money or turns truncated cents into a verified payout", async () => {
  const date = "2026-10-16";
  const first = fixture(`angelita-${date}.html`);
  const second = fixture(`comprobar-${date}.html`);
  for (const invalid of ["1.23 €", "1,234 €", "3", "3 USD", "1e3 €", "3 € aproximadamente"]) {
    assert.throws(() => parseComprobarHtml(second.replace("3,67 €", invalid), date), /céntimos/, invalid);
  }
  assert.throws(() => parseAngelitaHtml(first.replace("3,67 €", "3 €"), date), /céntimos/);
  const truncated = await publicChecker(first, second.replace("3,67 €", "3 €"))(date);
  assert.equal(truncated.ok, false);
  assert.equal(truncated.errorCode, "conflicting_sources");
  assert.equal(truncated.prizesVerified, undefined);
});

test("a real gap in Angelita's archive only returns the other publication's dated combination", async () => {
  for (const date of ["2026-01-30", "2026-02-06", "2026-02-13"]) {
    const first = fixture(`angelita-${date}.html`);
    const second = fixture(`comprobar-${date}.html`);
    assert.throws(() => parseAngelitaHtml(first, date), /fecha/);
    const result = await publicChecker(first, second)(date);
    assert.equal(result.ok, true, date);
    assert.equal(result.date, date);
    assert.equal(result.sourceName, "ComprobarEuromillones");
    assert.match(result.source, /comprobareuromillones\.com/);
    assert.deepEqual(result.prizes, []);
    assert.equal(result.prizesVerified, false);
    assert.equal(result.prizeSource, undefined);
    assert.match(result.message!, /única fuente/);
    const state = structuredClone(initialState);
    state.draws = state.draws.filter((draw) => draw.date === date);
    assert.equal(state.draws.length, 1);
    const draw = state.draws[0];
    const losing = applyCheckResult(state, draw.id, result);
    assert.equal(losing.draws[0].status, "checked", date);
    assert.equal(losing.draws[0].grossPrize, 0, date);
    draw.betNumbers = result.numbers;
    draw.betStars = result.stars;
    const winning = applyCheckResult(state, draw.id, result);
    assert.equal(winning.draws[0].status, "awaiting-prize", date);
    assert.equal(winning.draws[0].grossPrize, 0, date);
  }
});

test("a lone publication with the wrong date or invalid combination cannot provide a partial result", async () => {
  const date = "2026-02-06";
  const second = fixture(`comprobar-${date}.html`);
  for (const invalid of [second.replace("06/02/2026", "13/02/2026"), second.replace(/melate">\d+/, 'melate">99')]) {
    const result = await publicChecker(fixture(`angelita-${date}.html`), invalid)(date);
    assert.equal(result.ok, false);
    assert.equal(result.prizesVerified, undefined);
  }
});

test("one cent discrepancy anywhere in the table or mismatching combinations blocks payouts", async () => {
  const first = fixture("angelita-2026-10-16.html");
  const second = fixture("comprobar-2026-10-16.html");
  for (const changed of [second.replace("930,45 €", "930,46 €"), second.replace('melate">07', 'melate">08')]) {
    const result = await publicChecker(first, changed)("2026-10-16");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "conflicting_sources");
    assert.equal(result.prizesVerified, undefined);
  }
});

test("a single public source can never authorise payout", async () => {
  for (const [first, second] of [[fixture("angelita-2026-10-16.html"), 503], [503, fixture("comprobar-2026-10-16.html")]] as const) {
    const result = await publicChecker(first, second)("2026-10-16");
    assert.equal(result.ok, true);
    assert.equal(result.prizesVerified, false);
    assert.deepEqual(result.prizes, []);
  }
});

test("an official combination without payouts still tries corroboration and blocks conflicting numbers", async () => {
  for (const disagree of [false, true]) {
    const data = JSON.parse(recent); data[0].escrutinio = [];
    if (disagree) data[0].combinacion = "01 - 02 - 03 - 04 - 05 - 01 - 02";
    const check = createEuromillonesChecker({ now, fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("buscadorSorteos")) return response(JSON.stringify(data));
      if (url.includes("loteriaangelita.com")) return response(fixture("angelita-2026-10-16.html"));
      if (url.includes("comprobareuromillones.com")) return response(fixture("comprobar-2026-10-16.html"));
      return response("Missing", 404);
    } });
    const result = await check("2026-10-16");
    assert.equal(result.ok, !disagree);
    if (disagree) assert.equal(result.errorCode, "conflicting_sources");
    else assert.equal(result.prizesVerified, true);
  }
});

test("HTTP 429 pauses only its origin without retrying, while other sources and cached results remain usable", async () => {
  const calls = { angelita: 0, comprobar: 0 };
  const check = createEuromillonesChecker({ now, fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes("loteriaangelita.com")) {
      calls.angelita++;
      if (calls.angelita === 2) return new Response("Rate limited", { status: 429, headers: { "Retry-After": "120" } });
      return response(fixture("angelita-2026-10-16.html"));
    }
    if (url.includes("comprobareuromillones.com")) {
      calls.comprobar++;
      return response(fixture(`comprobar-${new URL(url).searchParams.get("del-dia")}.html`));
    }
    if (url.includes("rtve.es")) return response(rtve);
    return response("Blocked", 403);
  } });
  assert.equal((await check("2026-10-16")).prizesVerified, true);
  const limited = await check("2026-10-13");
  assert.notEqual(limited.prizesVerified, true);
  assert.match(limited.rawSnippet!, /HTTP 429/);
  const next = await check("2026-05-05");
  assert.notEqual(next.prizesVerified, true);
  assert.match(next.rawSnippet!, /fuente en pausa/);
  assert.equal(calls.angelita, 2);
  assert.equal(calls.comprobar, 3);
  // Cached, fully verified results do not cause a new request to either provider.
  assert.equal((await check("2026-10-16")).prizesVerified, true);
  assert.equal(calls.angelita, 2);
  assert.equal(calls.comprobar, 3);
});
