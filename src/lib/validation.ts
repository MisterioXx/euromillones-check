import type { AppConfig, AppState, CashMovement, DrawEntry, LogEntry, Participant } from "../types.js";
import { isValidIsoDate, isValidIsoTimestamp } from "./dates.js";

type RecordValue = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}.`);
}

function object(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "debe ser un objeto");
  return value as RecordValue;
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(path, "debe ser un texto no vacío");
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "debe ser verdadero o falso");
  return value;
}

function number(value: unknown, path: string, options: { negative?: boolean; integer?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "debe ser un número finito");
  if (!options.negative && value < 0) fail(path, "no puede ser negativo");
  if (options.integer && !Number.isSafeInteger(value)) fail(path, "debe ser un entero seguro");
  if (!options.integer && (!Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)) {
    fail(path, "debe ser un importe seguro con un máximo de dos decimales");
  }
  return value;
}

function date(value: unknown, path: string): string {
  if (!isValidIsoDate(value)) fail(path, "debe ser una fecha real con formato AAAA-MM-DD");
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path, true);
}

function timestamp(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidIsoTimestamp(value)) {
    fail(path, "debe ser una fecha y hora ISO válida");
  }
  return value;
}

function array<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, "debe ser una lista");
  return value.map((item, index) => parse(item, `${path}[${index}]`));
}

function unique<T extends { id: string }>(items: T[], path: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail(path, "hay identificadores duplicados");
  return items;
}

export function validateNumberList(value: unknown, min: number, max: number, expected: number, label = "Combinación"): number[] {
  if (!Array.isArray(value) || value.length !== expected) fail(label, `debe contener exactamente ${expected} números`);
  if (value.some((item) => !Number.isInteger(item) || item < min || item > max)) {
    fail(label, `solo admite enteros entre ${min} y ${max}`);
  }
  if (new Set(value).size !== expected) fail(label, "no admite números repetidos");
  return [...value].sort((a, b) => a - b);
}

export function parseNumberList(value: string, min: number, max: number, expected: number): number[] | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(?:[\s,]+\d+)*$/.test(trimmed)) return null;
  try {
    return validateNumberList(trimmed.split(/[\s,]+/).map(Number), min, max, expected);
  } catch {
    return null;
  }
}

function config(value: unknown): AppConfig {
  const item = object(value, "config");
  const startDate = date(item.startDate, "config.startDate");
  const endDate = date(item.endDate, "config.endDate");
  if (endDate < startDate) fail("config.endDate", "debe ser igual o posterior al inicio");
  return {
    ...item,
    startDate,
    endDate,
    numbers: validateNumberList(item.numbers, 1, 50, 5, "config.numbers"),
    stars: validateNumberList(item.stars, 1, 12, 2, "config.stars"),
    defaultCostPerLine: number(item.defaultCostPerLine, "config.defaultCostPerLine"),
    defaultLines: number(item.defaultLines, "config.defaultLines", { integer: true }),
    autoCheckOnOpen: bool(item.autoCheckOnOpen, "config.autoCheckOnOpen"),
  };
}

function participant(value: unknown, path: string): Participant {
  const item = object(value, path);
  return {
    ...item,
    id: string(item.id, `${path}.id`),
    name: string(item.name, `${path}.name`),
    annualContribution: number(item.annualContribution, `${path}.annualContribution`),
    extraContribution: number(item.extraContribution, `${path}.extraContribution`),
  };
}

function draw(value: unknown, path: string, appConfig: AppConfig, legacy: boolean): DrawEntry {
  const item = object(value, path);
  const statuses = ["pending", "checked", "manual", "awaiting-prize", "error"];
  if (!statuses.includes(String(item.status))) fail(`${path}.status`, "estado de sorteo desconocido");
  const notes = string(item.notes, `${path}.notes`, true);
  let status = item.status as DrawEntry["status"];
  if (legacy && status === "checked" && /importe\s+pendiente|sin\s+importe|no\s+incluy[oó].*premios/i.test(notes)) status = "awaiting-prize";
  const grossPrize = number(item.grossPrize, `${path}.grossPrize`);
  const lines = number(item.lines, `${path}.lines`, { integer: true });
  const costPerLine = number(item.costPerLine, `${path}.costPerLine`);
  if (!Number.isSafeInteger(lines * Math.round(costPerLine * 100))) fail(path, "el coste total supera el límite seguro");
  let prizeSource = item.prizeSource as DrawEntry["prizeSource"];
  if (prizeSource !== undefined && !["manual", "imported", "automatic"].includes(prizeSource)) fail(`${path}.prizeSource`, "origen del premio desconocido");
  if (!prizeSource && /importad[oa].*excel/i.test(notes)) prizeSource = "imported";
  if (!prizeSource && status === "manual") prizeSource = "manual";
  if (!prizeSource && grossPrize > 0) prizeSource = legacy && item.status === "checked" ? "automatic" : "manual";
  const uncertainLegacyPrize = legacy && item.status === "checked" && grossPrize > 0 &&
    !/^https:\/\/www\.loteriasyapuestas\.es\/servicios\/buscadorSorteos(?:[?/#]|$)/.test(String(item.resultSource ?? ""));
  if (uncertainLegacyPrize) {
    status = "awaiting-prize";
    prizeSource = "imported";
  }
  if ((item.winningNumbers === undefined) !== (item.winningStars === undefined)) fail(path, "la combinación ganadora debe incluir números y estrellas");
  return {
    ...item,
    id: string(item.id, `${path}.id`),
    date: date(item.date, `${path}.date`),
    played: bool(item.played, `${path}.played`),
    lines,
    costPerLine,
    grossPrize,
    expenses: number(item.expenses, `${path}.expenses`),
    notes,
    status,
    checkedAt: timestamp(item.checkedAt, `${path}.checkedAt`),
    lastAttemptAt: timestamp(item.lastAttemptAt, `${path}.lastAttemptAt`),
    betNumbers: validateNumberList(item.betNumbers ?? appConfig.numbers, 1, 50, 5, `${path}.betNumbers`),
    betStars: validateNumberList(item.betStars ?? appConfig.stars, 1, 12, 2, `${path}.betStars`),
    winningNumbers: item.winningNumbers === undefined ? undefined : validateNumberList(item.winningNumbers, 1, 50, 5, `${path}.winningNumbers`),
    winningStars: item.winningStars === undefined ? undefined : validateNumberList(item.winningStars, 1, 12, 2, `${path}.winningStars`),
    prizeSource,
    resultSource: optionalText(item.resultSource, `${path}.resultSource`),
    resultSummary: optionalText(item.resultSummary, `${path}.resultSummary`),
    checkError: optionalText(item.checkError, `${path}.checkError`) ?? (uncertainLegacyPrize
      ? "Importe histórico pendiente de contrastar con el escrutinio oficial. Se conserva hasta su revisión."
      : undefined),
  };
}

function movement(value: unknown, path: string): CashMovement {
  const item = object(value, path);
  if (!["adjustment", "external-ticket", "other"].includes(String(item.kind))) fail(`${path}.kind`, "tipo de movimiento desconocido");
  return {
    ...item,
    id: string(item.id, `${path}.id`),
    date: date(item.date, `${path}.date`),
    amount: number(item.amount, `${path}.amount`, { negative: true }),
    description: string(item.description, `${path}.description`),
    kind: item.kind as CashMovement["kind"],
  };
}

function log(value: unknown, path: string): LogEntry {
  const item = object(value, path);
  if (!["info", "warning", "error"].includes(String(item.level))) fail(`${path}.level`, "nivel de registro desconocido");
  return {
    ...item,
    id: string(item.id, `${path}.id`),
    at: timestamp(item.at, `${path}.at`) ?? fail(`${path}.at`, "falta la fecha del registro"),
    level: item.level as LogEntry["level"],
    message: string(item.message, `${path}.message`),
    ...(item.details === undefined ? {} : { details: optionalText(item.details, `${path}.details`) }),
  };
}

/** Validate before persisting or importing. Legacy conversion never changes money or user notes. */
export function validateState(input: unknown): AppState {
  const state = object(input, "Datos");
  if (state.version !== 1 && state.version !== 2) fail("version", "solo se admiten copias de las versiones 1 y 2");
  const appConfig = config(state.config);
  const draws = unique(array(state.draws, "draws", (item, path) => draw(item, path, appConfig, state.version === 1)), "draws");
  if (new Set(draws.map((item) => item.date)).size !== draws.length) fail("draws", "hay fechas de sorteo duplicadas");
  return {
    ...state,
    version: 2,
    config: appConfig,
    participants: unique(array(state.participants, "participants", participant), "participants"),
    draws,
    movements: unique(array(state.movements, "movements", movement), "movements"),
    logs: unique(array(state.logs, "logs", log), "logs"),
  };
}
