const formatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
});
const madridClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});

/** Calendar dates use UTC; the publication clock uses Europe/Madrid. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return isValidIsoDate(value.slice(0, 10)) && Number(value.slice(11, 13)) <= 23 &&
    Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59 && Number.isFinite(Date.parse(value));
}

export function parseIsoDate(value: string): Date {
  if (!isValidIsoDate(value)) throw new Error(`Fecha no válida: ${value || "vacía"}.`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDate(value: string): string {
  return formatter.format(parseIsoDate(value));
}

function madridParts(now: Date): Record<string, string> {
  return Object.fromEntries(madridClock.formatToParts(now).map((part) => [part.type, part.value]));
}

export function todayIso(now = new Date()): string {
  const parts = madridParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isResultDue(date: string, now = new Date()): boolean {
  if (!isValidIsoDate(date)) return false;
  const parts = madridParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return date < today || (date === today && Number(parts.hour) >= 22);
}

export function isPastOrToday(value: string, today = todayIso()): boolean {
  return value <= today;
}

export function weekdayShort(value: string): string {
  return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][parseIsoDate(value).getUTCDay()];
}

export function isoWeek(value: string): string {
  const date = parseIsoDate(value);
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
