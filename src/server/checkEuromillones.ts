import type { OfficialCheckResponse } from "../types.js";
import { createProviderThrottle, ProviderThrottleError } from "./providerThrottle.js";

const SELAE = "https://www.loteriasyapuestas.es";
const RTVE = "https://www.rtve.es/loterias/euromillones/";
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const HITS = [[5, 2], [5, 1], [5, 0], [4, 2], [4, 1], [3, 2], [4, 0], [2, 2], [3, 1], [3, 0], [1, 2], [2, 1], [2, 0]];
type Prize = NonNullable<OfficialCheckResponse["prizes"]>[number];
type ParsedResult = { date: string; numbers: number[]; stars: number[]; prizes: Prize[] };
type ErrorCode = "invalid_date" | "not_published" | "source_unavailable" | "invalid_source" | "conflicting_sources";

class SourceError extends Error {
  constructor(message: string, readonly code: ErrorCode = "invalid_source") { super(message); }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SourceError("Formato de datos inesperado.");
  return value as Record<string, unknown>;
}

export function validDrawDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    Number(value.slice(0, 4)) >= 2004 && [2, 5].includes(date.getUTCDay());
}

export function validCombination(numbers: unknown, stars: unknown): numbers is number[] {
  const valid = (value: unknown, count: number, max: number) => Array.isArray(value) &&
    value.length === count && new Set(value).size === count &&
    value.every((n) => Number.isInteger(n) && n >= 1 && n <= max);
  return valid(numbers, 5, 50) && valid(stars, 2, 12);
}

function combination(numbers: number[], stars: number[]): Pick<ParsedResult, "numbers" | "stars"> {
  if (!validCombination(numbers, stars)) throw new SourceError("La combinación recibida no es válida.");
  return { numbers: [...numbers].sort((a, b) => a - b), stars: [...stars].sort((a, b) => a - b) };
}

function money(value: unknown, html = false): number {
  if (typeof value !== "string") throw new SourceError("La fuente no incluyó una cuota válida.");
  const text = value.replace(/\s|€/g, "");
  let normalized: string;
  // The SELAE news template uses dots both for thousands and the decimal separator.
  if (html && /^(?:\d+|\d{1,3}(?:\.\d{3})+)\.\d{2}$/.test(text)) {
    const decimal = text.lastIndexOf(".");
    normalized = text.slice(0, decimal).replace(/\./g, "") + text.slice(decimal);
  } else if (/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else throw new SourceError("Formato de cuota desconocido; el importe requiere revisión.");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) throw new SourceError("Cuota fuera de rango.");
  return Math.round(amount * 100) / 100;
}

function category(value: unknown, label: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 13 || typeof label !== "string") throw new SourceError("Categoría de premio desconocida.");
  const match = label.trim().match(/^(\d{1,2})\s*[ªaº°]?\s*(\d)\s*\+\s*(\d)$/i);
  const expected = HITS[Number(value) - 1];
  if (!match || Number(match[1]) !== value || Number(match[2]) !== expected[0] || Number(match[3]) !== expected[1]) throw new SourceError("La categoría y los aciertos publicados no coinciden.");
  return Number(value);
}

function prizeRows(rows: Array<{ category: number; label: string; amount: string }>, html = false): Prize[] {
  const seen = new Set<number>();
  const prizes: Prize[] = [];
  for (const row of rows) {
    const number = category(row.category, row.label);
    if (seen.has(number)) throw new SourceError("La tabla de premios contiene categorías duplicadas.");
    seen.add(number);
    const amount = money(row.amount, html);
    // A zero means no winners, not a payable zero-euro prize.
    if (amount > 0) prizes.push({ category: `${number}a categoria`, amount,
      formattedAmount: new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount) });
  }
  return prizes;
}

export function parseSelaePayload(payload: unknown, date: string): ParsedResult | undefined {
  if (!Array.isArray(payload)) throw new SourceError("SELAE no devolvió una lista de sorteos.");
  if (payload.length === 0) return undefined;
  const matches = payload.map(record).filter((draw) => draw.game_id === "EMIL" && typeof draw.fecha_sorteo === "string" && draw.fecha_sorteo.slice(0, 10) === date);
  if (matches.length !== 1) throw new SourceError("SELAE devolvió una fecha o juego distintos de los solicitados.");
  const draw = matches[0];
  if (typeof draw.combinacion !== "string" || !/^\s*\d{1,2}(?:\s*-\s*\d{1,2}){6}\s*$/.test(draw.combinacion)) throw new SourceError("SELAE no incluyó una combinación completa.");
  const values = draw.combinacion.split("-").map((value) => Number(value.trim()));
  const result = combination(values.slice(0, 5), values.slice(5));
  if (draw.escrutinio != null && !Array.isArray(draw.escrutinio)) throw new SourceError("Escrutinio de SELAE no válido.");
  const rows = ((draw.escrutinio as unknown[] | undefined) ?? []).map((value) => {
    const row = record(value);
    return { category: row.categoria as number, label: row.tipo as string, amount: row.premio as string };
  });
  return { date, ...result, prizes: prizeRows(rows) };
}

function decode(value: string): string {
  const entities: Record<string, string> = { nbsp: " ", euro: "€", ordf: "ª", amp: "&", quot: '"', apos: "'", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ" };
  return value.replace(/&#(x[\da-f]+|\d+);|&([a-z]+);/gi, (whole, numeric: string | undefined, name: string) => {
    if (!numeric) return entities[name.toLowerCase()] ?? whole;
    const point = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric);
    return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function plain(html: string): string {
  return decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function paragraphCombination(html: string): Pick<ParsedResult, "numbers" | "stars"> {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => plain(match[1]));
  const candidates = paragraphs.filter((text) => /Estrellas\s*:/i.test(text));
  if (candidates.length !== 1) throw new SourceError("No se encontró una única combinación con estrellas.");
  const match = candidates[0].match(/^(\d{1,2}(?:\s*-\s*\d{1,2}){4})\s+Estrellas\s*:\s*(\d{1,2}\s*-\s*\d{1,2})$/i);
  if (!match) throw new SourceError("Formato de combinación no reconocido.");
  return combination(match[1].split("-").map(Number), match[2].split("-").map(Number));
}

export function selaeArticleUrl(date: string, prizes = true): string {
  const [year, month, day] = date.split("-");
  return `${SELAE}/es/euromillones/${prizes ? "escrutinios/euromillones-premios-y-ganadores" : "resultados/euromillones-resultados"}-del-${day}-de-${MONTHS[Number(month) - 1]}-de-${year}`;
}

export function parseSelaeArticle(html: string, date: string): ParsedResult {
  const start = html.search(/<div\b[^>]*class=["'][^"']*\bdetalleNoticia\b/i);
  if (start < 0) throw new SourceError("SELAE no devolvió la noticia del sorteo.");
  const article = html.slice(start);
  const heading = article.match(/<div\b[^>]*class=["']tituloRegion["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const [year, month, day] = date.split("-");
  if (!plain(heading).includes(`${day}/${month}/${year}`) || !/Euromillones/i.test(plain(heading))) throw new SourceError("La noticia oficial no corresponde a la fecha solicitada.");
  const result = paragraphCombination(article);
  const table = article.match(/<table\b[^>]*class=["']tablaDetalle["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  const rows: Array<{ category: number; label: string; amount: string }> = [];
  if (table) {
    if (!/Categoría.*Acertantes.*Premios/i.test(plain(table))) throw new SourceError("Cabecera del escrutinio desconocida.");
    for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plain(cell[1]));
      if (!cells.length) continue;
      if (cells.length !== 4) throw new SourceError("Fila incompleta en el escrutinio oficial.");
      rows.push({ category: Number(cells[0].match(/^\d+/)?.[0]), label: cells[0], amount: cells[2] });
    }
  }
  return { date, ...result, prizes: prizeRows(rows, true) };
}

export function parseRtveHtml(html: string, date: string): ParsedResult | undefined {
  const compact = date.replace(/-/g, "");
  const blocks = [...html.matchAll(/<li\b[^>]*\bid=["']emil_(\d{8})["'][^>]*>/gi)];
  const index = blocks.findIndex((match) => match[1] === compact);
  if (index < 0) return undefined;
  const block = html.slice(blocks[index].index, blocks[index + 1]?.index ?? html.length);
  const main = block.match(/<main\b[^>]*class=["'][^"']*\bmainBox\b[^"']*["'][^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const aux = block.match(/<section\b[^>]*class=["'][^"']*\bauxBox\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const values = (section: string) => [...section.matchAll(/<strong\b[^>]*class=["'][^"']*\bbet_right\b[^"']*["'][^>]*>\s*(\d+)\s*<\/strong>/gi)].map((match) => Number(match[1]));
  // RTVE's results widget truncates cents. Never use its displayed prize amounts.
  return { date, ...combination(values(main), values(aux)), prizes: [] };
}

export function parseRtveArticle(html: string, date: string): ParsedResult {
  const [year, month, day] = date.split("-");
  const metadata = [...html.matchAll(/<meta\b[^>]*itemprop=["']name["'][^>]*content=["']([^"']*)["'][^>]*>/gi)];
  if (!metadata.some((match) => /Euromillones/i.test(decode(match[1])) && decode(match[1]).includes(`${day}/${month}/${year}`))) throw new SourceError("La noticia de RTVE no acredita la fecha del sorteo.");
  const heading = /<h2\b[^>]*>\s*Euromillones\s*<\/h2>/i.exec(html);
  if (!heading) throw new SourceError("La noticia de RTVE no contiene el apartado de Euromillones.");
  const after = html.slice(heading.index + heading[0].length);
  const end = after.search(/<h2\b|<\/article>/i);
  return { date, ...paragraphCombination(end >= 0 ? after.slice(0, end) : after), prizes: [] };
}

export function publicResultUrls(date: string): [string, string] {
  const [year, month, day] = date.split("-");
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() === 2 ? "martes" : "viernes";
  return [
    `https://www.loteriaangelita.com/euromillones/temporada/${year}/jornada/${weekday}-${Number(day)}-${MONTHS[Number(month) - 1]}`,
    `https://www.comprobareuromillones.com/euromillones-${weekday}-amp.php?del-dia=${date}`,
  ];
}

function publicPrizeTable(table: string, columns: number, amountColumn: number, trailingE = false): Prize[] {
  const rows: Array<{ category: number; label: string; amount: string }> = [];
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plain(cell[1]));
    if (!cells.length) continue;
    if (cells.length !== columns) throw new SourceError("Tabla pública con columnas inesperadas.");
    const label = trailingE ? cells[0].replace(/e$/i, "") : cells[0];
    const amount = cells[amountColumn];
    // Require an explicit euro amount with cents, except for a published zero.
    if (!/^(?:0(?:,00)?|(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2})\s*€$/.test(amount)) throw new SourceError("Cuota pública sin céntimos o moneda verificables.");
    rows.push({ category: Number(label.match(/^\d+/)?.[0]), label, amount });
  }
  if (rows.length !== 13) throw new SourceError("El contraste requiere las 13 categorías completas.");
  return prizeRows(rows);
}

export function parseAngelitaHtml(html: string, date: string): ParsedResult {
  const [year, month, day] = date.split("-");
  const heading = plain(html.match(/<h2\b[^>]*>(Resultados del Euromillones del[\s\S]*?)<\/h2>/i)?.[1] ?? "");
  if (!heading.toLowerCase().endsWith(`${Number(day)} de ${MONTHS[Number(month) - 1]} del ${year}`)) throw new SourceError("La fecha de Lotería Angelita no coincide.");
  const section = (name: string) => html.match(new RegExp(`<div class="${name}">([\\s\\S]*?)<\\/div>\\s*<!-- ${name} -->`, "i"))?.[1] ?? "";
  const values = (value: string) => [...value.matchAll(/<span>\s*(\d+)\s*<\/span>/gi)].map((match) => Number(match[1]));
  const result = combination(values(section("wres_numeros")), values(section("wres_estrellas")));
  const table = html.match(/<table\b[^>]*id=["']resultado-quiniela-2["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  if (!/Categorías.*Premios.*Acertantes/i.test(plain(table))) throw new SourceError("Cabecera de Lotería Angelita desconocida.");
  return { date, ...result, prizes: publicPrizeTable(table, 3, 1) };
}

export function parseComprobarHtml(html: string, date: string): ParsedResult {
  const [year, month, day] = date.split("-");
  const heading = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  if (!new RegExp(`^Euromillones (Martes|Viernes) - ${day}/${month}/${year}$`, "i").test(heading)) throw new SourceError("La fecha de ComprobarEuromillones no coincide.");
  const marker = html.match(/<div\b[^>]*class=["'][^"']*\bnumeros-md-mov\b[^"']*["'][^>]*>/i);
  if (!marker) throw new SourceError("No se encontró la combinación pública.");
  const after = html.slice(marker.index! + marker[0].length);
  const block = after.slice(0, after.indexOf("<div>"));
  const values = (kind: string) => [...block.matchAll(new RegExp(`<span class="label label-${kind}">\\s*(\\d+)\\s*<\\/span>`, "gi"))].map((match) => Number(match[1]));
  const result = combination(values("melate"), values("comple"));
  const prizeHeading = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].find((match) =>
    plain(match[1]).toLowerCase() === `premios de euromillones del ${new Date(`${date}T12:00:00Z`).getUTCDay() === 2 ? "martes" : "viernes"} ${Number(day)} de ${MONTHS[Number(month) - 1]} de ${year}`);
  if (!prizeHeading) throw new SourceError("El escrutinio público no acredita su fecha.");
  const table = html.slice(prizeHeading.index! + prizeHeading[0].length).match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  if (!/Categor\..*Acert\..*Premios.*Acert\. Europa/i.test(plain(table))) throw new SourceError("Cabecera de ComprobarEuromillones desconocida.");
  return { date, ...result, prizes: publicPrizeTable(table, 4, 2, true) };
}

export function matchingPublicResults(first: ParsedResult, second: ParsedResult): boolean {
  return first.date === second.date && first.numbers.join() === second.numbers.join() && first.stars.join() === second.stars.join() &&
    first.prizes.length > 0 && first.prizes.length === second.prizes.length && first.prizes.every((row) =>
      second.prizes.some((other) => other.category === row.category && Math.round(other.amount * 100) === Math.round(row.amount * 100)));
}

function madridToday(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function latestDueDate(now: Date): string {
  const date = new Date(`${madridToday(now)}T12:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < 22) date.setUTCDate(date.getUTCDate() - 1);
  while (![2, 5].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function createEuromillonesChecker(options: {
  fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; retryDelayMs?: number; signal?: AbortSignal; sourceIntervalMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 3000;
  const cache = new Map<string, { until: number; result: OfficialCheckResponse }>();
  const inFlight = new Map<string, Promise<OfficialCheckResponse>>();
  let rtveIndex: { until: number; html: string } | undefined;
  const throttle = createProviderThrottle({ signal: options.signal });

  async function get(url: string, retry = false): Promise<string> {
    const origin = new URL(url).origin;
    const publicSource = origin === "https://www.loteriaangelita.com" || origin === "https://www.comprobareuromillones.com";
    try {
      return await throttle.run(origin, publicSource ? Math.max(0, options.sourceIntervalMs ?? 1000) : 0, () => getUnthrottled(url, retry));
    } catch (error) {
      if (error instanceof ProviderThrottleError) throw new SourceError(error.message, "source_unavailable");
      throw error;
    }
  }

  async function getUnthrottled(url: string, retry: boolean): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new SourceError("Presupuesto de comprobación agotado.", "source_unavailable");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { signal: controller.signal, headers: {
          accept: "application/json,text/html;q=0.9", "user-agent": "EuroControl/1.0 (public draw results)",
        } });
        if (!response.ok) {
          if (response.status === 429) throttle.rateLimited(new URL(url).origin, response.headers.get("retry-after"));
          const error = new SourceError(`HTTP ${response.status}`, response.status === 404 ? "not_published" : "source_unavailable");
          if (retry && attempt === 0 && response.status >= 500) throw error;
          throw Object.assign(error, { doNotRetry: true });
        }
        const body = await response.text();
        if (body.length > 1_500_000) throw new SourceError("Respuesta demasiado grande.");
        return body;
      } catch (error) {
        if (!retry || attempt > 0 || options.signal?.aborted || (error as { doNotRetry?: boolean })?.doNotRetry || error instanceof SourceError && error.code === "invalid_source") {
          if (error instanceof SourceError) throw error;
          const networkCode = (error as { cause?: { code?: unknown } })?.cause?.code;
          const detail = typeof networkCode === "string" && /^[A-Z_]{3,40}$/.test(networkCode) ? ` (${networkCode})` : "";
          throw new SourceError(controller.signal.aborted ? "Tiempo de espera agotado." : `No se pudo conectar con la fuente${detail}.`, "source_unavailable");
        }
      } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 150));
    }
  }

  async function check(date: string): Promise<OfficialCheckResponse> {
    const fetchedAt = now().toISOString();
    const errors: Array<{ source: string; error: SourceError }> = [];
    const compact = date.replace(/-/g, "");
    const jsonUrl = `${SELAE}/servicios/buscadorSorteos?game_id=EMIL&celebrados=true&fechaInicioInclusiva=${compact}&fechaFinInclusiva=${compact}`;
    let partial: OfficialCheckResponse | undefined;
    const diagnostics = () => errors.map(({ source, error }) => `${source}: ${error.message}`).join(" · ").slice(0, 600);
    const finish = (result: OfficialCheckResponse): OfficialCheckResponse => errors.length ? { ...result, rawSnippet: diagnostics() } : result;
    const success = (parsed: ParsedResult, source: string, official: boolean): OfficialCheckResponse => ({
      ok: true, ...parsed, source, fetchedAt, requestedDate: date, sourceName: official ? "SELAE" : "RTVE",
      prizesVerified: official && parsed.prizes.length > 0,
      prizeSource: official && parsed.prizes.length > 0 ? source : undefined,
      message: parsed.prizes.length ? undefined : "Combinación verificada. El importe queda pendiente hasta disponer de una cuota fiable contrastada.",
    });
    const attempt = async (name: string, read: () => Promise<OfficialCheckResponse | undefined>) => {
      try { return await read(); }
      catch (error) {
        const safeError = error instanceof SourceError ? error : new SourceError("Respuesta no reconocida.");
        errors.push({ source: name, error: safeError });
        // Fixed provider labels and validated date only; never log response HTML or private state.
        console.warn(`EuroControl fuente ${name} ${date}: ${safeError.code}; ${safeError.message}`);
        return undefined;
      }
    };
    const json = await attempt("SELAE JSON", async () => {
      const parsed = parseSelaePayload(JSON.parse(await get(jsonUrl, true)), date);
      return parsed ? success(parsed, jsonUrl, true) : undefined;
    });
    if (json?.prizes?.length) return json;
    partial = json;
    // Historical articles are date-specific and remain usable after a draw leaves the front page.
    for (const hasPrizes of [true, false]) {
      const url = selaeArticleUrl(date, hasPrizes);
      const article = await attempt(hasPrizes ? "SELAE escrutinio" : "SELAE resultado", async () => success(parseSelaeArticle(await get(url), date), url, true));
      if (article) {
        if (partial && (partial.numbers?.join() !== article.numbers?.join() || partial.stars?.join() !== article.stars?.join())) {
          return { ok: false, source: url, sourceName: "SELAE", fetchedAt, requestedDate: date, date,
            errorCode: "conflicting_sources", message: "Las fuentes del sorteo discrepan. Se necesita revisión antes de actualizar el saldo." };
        }
        if (article.prizes?.length) return finish(article);
        partial = article;
      }
      if (partial) break;
    }
    // Two Spanish publications are accepted only when their complete tables agree.
    // Neither website is presented as SELAE, and a single publication never authorises a payout.
    const publicUrls = publicResultUrls(date);
    const corroboration = await Promise.all([
      attempt("Lotería Angelita", async () => success(parseAngelitaHtml(await get(publicUrls[0]), date), publicUrls[0], false)),
      attempt("ComprobarEuromillones", async () => success(parseComprobarHtml(await get(publicUrls[1]), date), publicUrls[1], false)),
    ]);
    const [first, second] = corroboration;
    if (first && second) {
      if (matchingPublicResults(first as ParsedResult, second as ParsedResult) && (!partial ||
        partial.numbers?.join() === first.numbers?.join() && partial.stars?.join() === first.stars?.join())) {
        return finish({ ...first, sourceName: "Lotería Angelita + ComprobarEuromillones", prizesVerified: true,
          prizeSource: publicUrls[1], message: "Cuotas de España contrastadas en dos publicaciones." });
      }
      return finish({ ok: false, source: publicUrls[0], prizeSource: publicUrls[1], fetchedAt, requestedDate: date, date,
        errorCode: "conflicting_sources", message: "Las publicaciones del sorteo discrepan. Se necesita revisión antes de actualizar el saldo." });
    }
    if (partial) return finish(partial);
    const fallback = await attempt("RTVE", async () => {
      if (!rtveIndex || rtveIndex.until <= now().getTime()) rtveIndex = { html: await get(RTVE), until: now().getTime() + 300_000 };
      const parsed = parseRtveHtml(rtveIndex.html, date);
      if (parsed) return success(parsed, RTVE, false);
      const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      const publicationDates = [compact, next.toISOString().slice(0, 10).replace(/-/g, "")];
      const links = [...new Set([...rtveIndex.html.matchAll(/href=["'](https:\/\/www\.rtve\.es\/rtve\/\d{8}\/[^"']*euromillones[^"']*\.shtml)["']/gi)].map((match) => decode(match[1])))];
      for (const link of links.filter((url) => publicationDates.some((value) => url.includes(`/rtve/${value}/`))).slice(0, 2)) {
        const article = await attempt("RTVE archivo", async () => success(parseRtveArticle(await get(link), date), link, false));
        if (article) return article;
      }
      return undefined;
    });
    if (fallback) return finish(fallback);
    const errorCode: ErrorCode = errors.some(({ error }) => error.code === "invalid_source") ? "invalid_source" :
      errors.some(({ error }) => error.code === "source_unavailable") ? "source_unavailable" : "not_published";
    return { ok: false, source: jsonUrl, sourceName: "SELAE / Lotería Angelita / ComprobarEuromillones / RTVE", fetchedAt, requestedDate: date, date, errorCode,
      message: errorCode === "not_published" && date >= madridToday(now())
        ? "El resultado todavía no está disponible. Se volverá a intentar."
        : `No se pudo recuperar un resultado fiable del ${date}. Los demás sorteos pueden seguir comprobándose.`,
      rawSnippet: diagnostics() };
  }

  return async (requestedDate?: string): Promise<OfficialCheckResponse> => {
    const date = requestedDate ?? latestDueDate(now());
    if (!validDrawDate(date)) return { ok: false, source: SELAE, fetchedAt: now().toISOString(), requestedDate,
      errorCode: "invalid_date", message: "Indica una fecha válida de sorteo (martes o viernes) con formato AAAA-MM-DD." };
    if (date > madridToday(now())) return { ok: false, source: SELAE, fetchedAt: now().toISOString(), requestedDate: date, date,
      errorCode: "not_published", message: "Este sorteo aún no se ha celebrado." };
    const cached = cache.get(date);
    if (cached && cached.until > now().getTime()) return structuredClone(cached.result);
    if (inFlight.has(date)) return structuredClone(await inFlight.get(date)!);
    const work = check(date);
    inFlight.set(date, work);
    try {
      const result = await work;
      if (result.ok) {
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(date, { until: now().getTime() + (result.prizesVerified ? 900_000 : 60_000), result: structuredClone(result) });
      }
      return result;
    } finally { inFlight.delete(date); }
  };
}

export const fetchEuromillonesResult = createEuromillonesChecker();
