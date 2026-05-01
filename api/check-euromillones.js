const OFFICIAL_URL = "https://www.loteriasyapuestas.es/es/resultados/euromillones";
const OFFICIAL_EMBED_URL =
  "https://www.loteriasyapuestas.es/f/loterias/resultados/euromillones.html";
const RTVE_URL = "https://www.rtve.es/loterias/euromillones/";

function normalizeText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEuroAmount(value) {
  const normalized = value.replace(/\s/g, "").replace(/[€EUR]/gi, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactFromIsoDate(value) {
  return value.replace(/-/g, "");
}

function isoFromCompactDate(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function extractRtveBlock(html, date) {
  const compact = date ? compactFromIsoDate(date) : undefined;
  const idMatch = compact
    ? new RegExp(`<li\\s+id=['"]emil_${compact}['"]`, "i").exec(html)
    : /<li\s+id=['"]emil_(\d{8})['"]/i.exec(html);

  if (!idMatch) return {};

  const start = idMatch.index;
  const matchedDate = compact ?? idMatch[1];
  const nextMatch = /<li\s+id=['"]emil_\d{8}['"]/i.exec(html.slice(start + idMatch[0].length));
  const end = nextMatch ? start + idMatch[0].length + nextMatch.index : html.length;

  return { date: isoFromCompactDate(matchedDate), block: html.slice(start, end) };
}

function extractBetRightValues(block) {
  return [...block.matchAll(/<strong\s+class=['"]bet_right['"]>(\d{1,2})<\/strong>/gi)].map((match) =>
    Number(match[1]),
  );
}

function parseRtvePrizes(block) {
  const prizes = [];
  const rows = block.match(/<tr>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const categoryMatch = row.match(/<strong>\s*(\d{1,2})\D[\s\S]*?<\/strong>/i);
    const amountMatch = row.match(/<td>\s*([\d.]+,\d{2})\s*(?:&euro;|€)\s*<\/td>/i);
    if (!categoryMatch || !amountMatch) continue;

    prizes.push({
      category: `${Number(categoryMatch[1])}a categoria`,
      amount: parseEuroAmount(amountMatch[1]),
      formattedAmount: `${amountMatch[1]} €`,
    });
  }

  return prizes;
}

async function fetchRtveResult(date) {
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
  if (!block || !resultDate) {
    return {
      ok: false,
      source: RTVE_URL,
      fetchedAt,
      requestedDate: date,
      date,
      message: date
        ? `No hay resultado publicado para ${date}. Si es un sorteo de hoy, vuelve a comprobar despues de las 22:00.`
        : "No se encontro ningun resultado de Euromillones publicado.",
      rawSnippet: date ? `RTVE no contiene un bloque de resultado para ${date}.` : normalizeText(html).slice(0, 700),
    };
  }

  const mainBox = block.match(/<main\s+class=['"]mainBox['"]>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const auxBox = block.match(/<section\s+class=['"]auxBox['"]>([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const numbers = extractBetRightValues(mainBox).slice(0, 5);
  const stars = extractBetRightValues(auxBox).slice(0, 2);
  const prizes = parseRtvePrizes(block);

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

async function fetchSelaeResult(date) {
  const urls = date
    ? [
        `${OFFICIAL_EMBED_URL}?game_id=EMIL&fecha_sorteo=${compactFromIsoDate(date)}`,
        `${OFFICIAL_URL}?fecha_sorteo=${compactFromIsoDate(date)}`,
      ]
    : [OFFICIAL_URL];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 EuromillonesControl/0.1",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (response.ok) return undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export default async function handler(request, response) {
  response.setHeader("content-type", "application/json; charset=utf-8");

  try {
    const requestUrl = new URL(request.url ?? "/", `https://${request.headers.host ?? "localhost"}`);
    const date = requestUrl.searchParams.get("date") || undefined;

    await fetchSelaeResult(date);
    const result = await fetchRtveResult(date);
    response.status(result.ok ? 200 : 404).json(result);
  } catch (error) {
    response.status(200).json({
      ok: false,
      source: RTVE_URL,
      fetchedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "Error desconocido comprobando Euromillones.",
    });
  }
}
