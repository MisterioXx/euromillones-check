const formatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(value: string): string {
  return formatter.format(parseIsoDate(value));
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function isPastOrToday(value: string, today = todayIso()): boolean {
  return value <= today;
}

export function weekdayShort(value: string): string {
  return ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][parseIsoDate(value).getDay()];
}

export function isoWeek(value: string): string {
  const date = parseIsoDate(value);
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
