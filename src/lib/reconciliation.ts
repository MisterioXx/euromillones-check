import type { AppState, DrawEntry, LogEntry, OfficialCheckResponse } from "../types.js";
import { isResultDue, isValidIsoDate, isValidIsoTimestamp, parseIsoDate, toIsoDate } from "./dates.js";
import { categoryLabel, countMatches, toCents } from "./domain.js";
import { validateNumberList, validateState } from "./validation.js";

export { isResultDue } from "./dates.js";

function categoryNumber(category: string): number | undefined {
  const match = category.trim().match(/^(\d{1,2})(?:\D|$)/);
  const number = match ? Number(match[1]) : undefined;
  return number !== undefined && number >= 1 && number <= 13 ? number : undefined;
}

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    Number.isSafeInteger(toCents(value)) && Math.abs(value * 100 - toCents(value)) < 0.00001;
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

/** Pure state transition: one award field per draw, no additive payment or storage side effects. */
export function applyCheckResult(state: AppState, drawId: string, result: OfficialCheckResponse): AppState {
  const draw = state.draws.find((entry) => entry.id === drawId);
  if (!draw) throw new Error(`No existe el sorteo ${drawId}.`);
  const validFetchedAt = isValidIsoTimestamp(result.fetchedAt);
  // An invalid response timestamp must not inject a non-ISO value into the saved state.
  const at = validFetchedAt ? result.fetchedAt : draw.lastAttemptAt ?? draw.checkedAt ?? `${draw.date}T00:00:00.000Z`;
  const diagnostics = typeof result.rawSnippet === "string" ? ` Diagnóstico: ${result.rawSnippet.slice(0, 600)}` : "";

  function finish(patch: Partial<DrawEntry>, level: LogEntry["level"], message: string, details: string): AppState {
    const next = { ...draw!, ...patch, lastAttemptAt: at };
    const log: LogEntry = {
      id: `check-${drawId}-${at}-${fingerprint(`${level}|${message}|${details}`)}`,
      at,
      level,
      message,
      details,
    };
    return {
      ...state,
      draws: state.draws.map((entry) => entry.id === drawId ? next : entry),
      logs: state.logs.some((entry) => entry.id === log.id) ? state.logs : [log, ...state.logs],
    };
  }

  function failure(message: string): AppState {
    return finish({ status: "error", checkError: message }, "error", `No se pudo comprobar el sorteo ${draw!.date}.`, `${message} Fuente: ${result.source || "no indicada"}.${diagnostics}`);
  }

  if (!validFetchedAt) return failure("La fuente no indicó una fecha de consulta válida.");
  if (result.ok !== true) return failure(result.message || "La fuente no ha publicado un resultado válido.");
  if (!draw.played) return failure("Este sorteo no figura como jugado; no se modificará su premio.");
  if (result.date !== draw.date || (result.requestedDate !== undefined && result.requestedDate !== draw.date)) {
    return failure(`La fecha recibida (${result.date ?? "ausente"}) no coincide con la solicitada (${draw.date}).`);
  }
  if (typeof result.source !== "string" || !result.source.trim()) return failure("El resultado no identifica su fuente.");

  let numbers: number[], stars: number[], betNumbers: number[], betStars: number[];
  try {
    numbers = validateNumberList(result.numbers, 1, 50, 5, "Números ganadores");
    stars = validateNumberList(result.stars, 1, 12, 2, "Estrellas ganadoras");
    betNumbers = validateNumberList(draw.betNumbers ?? state.config.numbers, 1, 50, 5, "Números de la apuesta");
    betStars = validateNumberList(draw.betStars ?? state.config.stars, 1, 12, 2, "Estrellas de la apuesta");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Combinación no válida.");
  }

  const { numberHits, starHits } = countMatches(betNumbers, betStars, numbers, stars);
  const category = categoryLabel(numberHits, starHits);
  const expectedCategory = categoryNumber(category);
  const summary = `${category}. Aciertos: ${numberHits} números y ${starHits} estrellas.`;
  const resultPatch: Partial<DrawEntry> = {
    winningNumbers: numbers,
    winningStars: stars,
    betNumbers,
    betStars,
    checkedAt: at,
    resultSource: result.source,
    resultSummary: summary,
  };
  const sourceDetails = `Fuente: ${result.sourceName || result.source}. ${result.source}${result.prizeSource ? ` Escrutinio: ${result.prizeSource}.` : ""}${diagnostics}`;

  function pendingPrize(message: string): AppState {
    return finish({ ...resultPatch, status: "awaiting-prize", checkError: message }, "warning", `Premio pendiente de revisión: ${draw!.date}.`, `${summary} ${message} ${sourceDetails}`);
  }

  if (result.category !== undefined) {
    const sourceCategory = result.category === "Sin premio" ? undefined : categoryNumber(result.category);
    if ((result.category !== "Sin premio" && sourceCategory === undefined) || sourceCategory !== expectedCategory) {
      return failure("La categoría indicada por la fuente no coincide con los aciertos de la apuesta guardada.");
    }
  }
  if (draw.lines !== 1) return pendingPrize("Hay varias líneas o ninguna; es necesario revisar las apuestas antes de aplicar un importe.");

  let amount: number | undefined = category === "Sin premio" ? 0 : undefined;
  if (category !== "Sin premio") {
    if (result.prizesVerified !== true) return pendingPrize("El importe no está verificado. Se conserva el premio registrado y se reintentará la consulta.");
    if (result.prizeAmount !== undefined) {
      if (!validAmount(result.prizeAmount) || result.prizeAmount === 0) return pendingPrize("La fuente no ofrece un importe positivo válido para esta categoría premiada.");
      // A direct amount needs its category so it cannot be mistaken for the jackpot or another award.
      if (result.category === undefined) return pendingPrize("El importe recibido no identifica a qué categoría pertenece.");
      amount = result.prizeAmount;
    }
    if (result.prizes !== undefined) {
      if (!Array.isArray(result.prizes)) return failure("La tabla de premios no tiene un formato válido.");
      const seen = new Set<number>();
      for (const prize of result.prizes) {
        const prizeCategory = prize && typeof prize.category === "string" ? categoryNumber(prize.category) : undefined;
        if (!prizeCategory || seen.has(prizeCategory) || !validAmount(prize.amount)) return failure("La tabla de premios contiene categorías duplicadas o importes no válidos.");
        seen.add(prizeCategory);
        if (prizeCategory === expectedCategory) {
          if (amount !== undefined && toCents(amount) !== toCents(prize.amount)) return failure("La fuente devuelve importes contradictorios para la misma categoría.");
          amount = prize.amount;
        }
      }
    }
    if (amount === undefined || amount === 0) return pendingPrize("Falta un importe positivo confirmado para esta categoría en el escrutinio.");
  } else if (result.prizeAmount !== undefined && result.prizeAmount !== 0) {
    return failure("La fuente indica un importe para una combinación sin premio.");
  }

  const protectedPrize = draw.prizeSource === "manual" || draw.prizeSource === "imported" || draw.status === "manual" ||
    (draw.grossPrize > 0 && draw.prizeSource !== "automatic");
  if (protectedPrize && toCents(draw.grossPrize) !== toCents(amount!)) {
    return pendingPrize(`El importe publicado (${amount!.toFixed(2)} €) difiere del registrado manualmente o importado (${draw.grossPrize.toFixed(2)} €). Se conserva el importe existente hasta su revisión.`);
  }
  return finish({
    ...resultPatch,
    status: protectedPrize ? "manual" : "checked",
    grossPrize: amount!,
    prizeSource: protectedPrize ? draw.prizeSource ?? "manual" : "automatic",
    checkError: undefined,
  }, "info", `Sorteo ${draw.date} comprobado: ${category}.`, `${summary} Premio registrado: ${amount!.toFixed(2)} €. ${sourceDetails}`);
}

export function getPendingDraws(state: AppState, now = new Date()): DrawEntry[] {
  return state.draws
    .filter((draw) => draw.played && ["pending", "error", "awaiting-prize"].includes(draw.status) && isResultDue(draw.date, now))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Extend the calendar only. Contributions and every existing draw remain unchanged. */
export function renewPeriod(state: AppState, endDate: string): AppState {
  if (!isValidIsoDate(endDate)) throw new Error("La nueva fecha de fin no es válida.");
  if (endDate < state.config.endDate) throw new Error("La renovación no puede acortar el periodo existente.");
  if (endDate === state.config.endDate) return state;
  const start = parseIsoDate(state.config.endDate);
  const end = parseIsoDate(endDate);
  if (end.getTime() - start.getTime() > 5 * 366 * 86400000) throw new Error("Amplía el periodo en intervalos de hasta cinco años.");
  const dates = new Set(state.draws.map((draw) => draw.date));
  const added: DrawEntry[] = [];
  for (const cursor = new Date(start.getTime() + 86400000); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (![2, 5].includes(cursor.getUTCDay())) continue;
    const date = toIsoDate(cursor);
    if (dates.has(date)) continue;
    added.push({
      id: `draw-${date}`, date, played: true,
      lines: state.config.defaultLines, costPerLine: state.config.defaultCostPerLine,
      grossPrize: 0, expenses: 0, notes: "", status: "pending",
      betNumbers: [...state.config.numbers], betStars: [...state.config.stars],
    });
  }
  const renewed = { ...state, config: { ...state.config, endDate }, draws: [...state.draws, ...added] };
  validateState(renewed);
  return renewed;
}
