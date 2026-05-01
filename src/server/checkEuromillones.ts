import type { OfficialCheckResponse } from "../types";

const OFFICIAL_URL = "https://www.loteriasyapuestas.es/es/resultados/euromillones";
const OFFICIAL_EMBED_URL =
  "https://www.loteriasyapuestas.es/f/loterias/resultados/euromillones.html";
const RTVE_URL = "https://www.rtve.es/loterias/euromillones/";

type PrizeRow = NonNullable<OfficialCheckResponse["prizes"]>[number];

function normalizeText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values: number[]): number[] {
  return [...new Set(values)];
}

function parseNumbers(text: string): { numbers?: number[]; stars?: number[]; rawSnippet?: string } {
  const lower = text.toLowerCase();
  const idx = lower.indexOf("ver por orden de aparicion");
  const fallbackIdx = lower.indexOf("ver por orden de aparición");
  const start = idx >= 0 ? idx : fallbackIdx;
  const snippet = text.slice(Math.max(0, start), start >= 0 ? start + 900 : 900);
  const candidates = uniq((snippet.match(/\b\d{1,2}\b/g) ?? []).map(Number));
  const numbers = candidates.filter((value) => value >= 1 && value <= 50).slice(0, 5);
  const starCandidates = candidates.filter((value) => value >= 1 && value <= 12);
  const stars = starCandidates.slice(-2);

  return {
    numbers: numbers.length === 5 ? numbers : undefined,
    stars: stars.length === 2 ? stars : undefined,
    rawSnippet: snippet,
  };
}

function parseDate(text: string): string | undefined {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+Euromillones/i);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatSelaeDate(date: string): string {
  return date.replace(/-/g, "");
}

function parseEuroAmount(value: string): number {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[€EUR]/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function htmlDecode(value: string): string {
  return value
    .replace(/&euro;/gi, "€")
    .replace(/&nbsp;/gi, " ")
    .replace(/&iacute;/gi, "í")
    .replace(/&uacute;/gi, "ú")
    .replace(/&oacute;/gi, "ó")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&ordf;/gi, "ª")
    .replace(/&#170;/g, "ª")
    .replace(/&amp;/gi, "&");
}

function parsePrizes(text: string): PrizeRow[] {
  const prizes: PrizeRow[] = [];
  const regex =
    /(?:categoria|categoría|cat\.?)\s*(\d{1,2})\D{0,80}?(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text))) {
    const category = `${Number(match[1])}a categoria`;
    const formattedAmount = `${match[2]} €`;
    prizes.push({
      category,
      amount: parseEuroAmount(match[2]),
      formattedAmount,
    });
  }

  return prizes;
}

async function fetchOfficialText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const official = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 EuromillonesControl/0.1 (+https://vercel.app; private household checker)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const html = await official.text();
  return {
    ok: official.ok,
    status: official.status,
    text: normalizeText(html),
  };
}

function isoFromCompactDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function compactFromIsoDate(value: string): string {
  return value.replace(/-/g, "");
}

function extractRtveBlock(html: string, date?: string): { date?: string; block?: string } {
  const compact = date ? compactFromIsoDate(date) : undefined;
  const idMatch = compact
    ? new RegExp(`<li\\s+id=['"]emil_${compact}['"]`, "i").exec(html)
    : /<li\s+id=['"]emil_(\d{8})['"]/i.exec(html);

  if (!idMatch) return {};

  const start = idMatch.index;
  const matchedDate = compact ?? idMatch[1];
  const nextMatch = /<li\s+id=['"]emil_\d{8}['"]/i.exec(html.slice(start + idMatch[0].length));
  const end = nextMatch ? start + idMatch[0].length + nextMatch.index : html.length;

  return {
    date: isoFromCompactDate(matchedDate),
    block: html.slice(start, end),
  };
}

function extractBetRightValues(block: string): number[] {
  return [...block.matchAll(/<strong\s+class=['"]bet_right['"]>(\d{1,2})<\/strong>/gi)].map((match) =>
    Number(match[1]),
  );
}

function parseRtvePrizes(block: string): PrizeRow[] {
  const prizes: PrizeRow[] = [];
  const rows = block.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const categoryMatch = row.match(/<strong>\s*(\d{1,2})\D[\s\S]*?<\/strong>/i);
    const amountMatch = row.match(/<td>\s*([\d.]+,\d{2})\s*(?:&euro;|€)\s*<\/td>/i);
    if (!categoryMatch || !amountMatch) continue;

    const formattedAmount = `${amountMatch[1]} €`;
    prizes.push({
      category: `${Number(categoryMatch[1])}a categoria`,
      amount: parseEuroAmount(amountMatch[1]),
      formattedAmount,
    });
  }

  return prizes;
}

async function fetchRtveResult(date?: string): Promise<OfficialCheckResponse | undefined> {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(RTVE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0 EuromillonesControl/0.1",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const html = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      source: RTVE_URL,
      fetchedAt,
      requestedDate: date,
      date,
      message: `RTVE respondio con HTTP ${response.status}.`,
      rawSnippet: normalizeText(html).slice(0, 700),
    };
  }

  const { date: resultDate, block } = extractRtveBlock(html, date);
  if (!block || !resultDate) return undefined;

  const mainBox = block.match(/<main\s+class=['"]mainBox['"]>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const auxBox = block.match(/<section\s+class=['"]auxBox['"]>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const numbers = extractBetRightValues(mainBox).slice(0, 5);
  const stars = extractBetRightValues(auxBox).slice(0, 2);
  const prizes = parseRtvePrizes(htmlDecode(block));

  if (numbers.length !== 5 || stars.length !== 2) {
    return {
      ok: false,
      source: RTVE_URL,
      fetchedAt,
      requestedDate: date,
      date: resultDate,
      message: "RTVE respondio, pero no se pudieron extraer numeros y estrellas.",
      rawSnippet: normalizeText(block).slice(0, 700),
    };
  }

  return {
    ok: true,
    source: RTVE_URL,
    fetchedAt,
    requestedDate: date,
    date: resultDate,
    numbers,
    stars,
    prizes,
    rawSnippet: normalizeText(block).slice(0, 700),
  };
}

export async function fetchEuromillonesResult(date?: string): Promise<OfficialCheckResponse> {
  const fetchedAt = new Date().toISOString();
  const requestedDate = date;

  try {
    const urls = date
      ? [
          `${OFFICIAL_EMBED_URL}?game_id=EMIL&fecha_sorteo=${formatSelaeDate(date)}`,
          `${OFFICIAL_URL}?fecha_sorteo=${formatSelaeDate(date)}`,
        ]
      : [OFFICIAL_URL];

    let lastText = "";
    let lastStatus = 0;

    for (const url of urls) {
      const { ok, status, text } = await fetchOfficialText(url);
      lastText = text;
      lastStatus = status;

      if (!ok) continue;

      if (/geobloqueo|ubicacion|territorio español|territorio espanol/i.test(text)) {
        return {
          ok: false,
          source: url,
          fetchedAt,
          requestedDate,
          date,
          message:
            "SELAE ha bloqueado la consulta por geolocalizacion. Usa una fuente alternativa o despliega la funcion desde region espanola.",
          rawSnippet: text.slice(0, 700),
        };
      }

      const parsed = parseNumbers(text);
      const parsedDate = parseDate(text) ?? date;
      const prizes = parsePrizes(text);

      if (!parsed.numbers || !parsed.stars) continue;

      return {
        ok: true,
        source: url,
        fetchedAt,
        requestedDate,
        date: parsedDate,
        numbers: parsed.numbers,
        stars: parsed.stars,
        prizes,
        rawSnippet: parsed.rawSnippet,
      };
    }

    const rtveResult = await fetchRtveResult(date);
    if (rtveResult) return rtveResult;

    return {
      ok: false,
      source: date ? RTVE_URL : OFFICIAL_URL,
      fetchedAt,
      requestedDate,
      date,
      message:
        date
          ? `No hay resultado publicado para ${date}. Si es un sorteo de hoy, vuelve a comprobar despues de las 22:00.`
          : lastStatus >= 400
          ? `SELAE respondio con HTTP ${lastStatus} y no se encontro fallback disponible.`
          : "No se pudieron extraer numeros, estrellas y premios de la pagina oficial.",
      rawSnippet: date
        ? `RTVE no contiene un bloque de resultado para ${date}.`
        : lastText.slice(0, 700),
    };
  } catch (error) {
    return {
      ok: false,
      source: OFFICIAL_URL,
      fetchedAt,
      requestedDate,
      date,
      message: error instanceof Error ? error.message : "Error desconocido consultando SELAE.",
    };
  }
}
