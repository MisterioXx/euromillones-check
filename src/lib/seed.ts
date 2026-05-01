import type { AppState, DrawEntry } from "../types";
import { parseIsoDate, toIsoDate } from "./dates";

const importedCheckedUntil = "2026-05-01";

function generateDraws(startDate: string, endDate: string): DrawEntry[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const draws: DrawEntry[] = [];

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getDay();
    if (day !== 2 && day !== 5) continue;

    const date = toIsoDate(cursor);
    const isKnownPrize = date === "2026-03-17";
    const wasCheckedInExcel = date <= importedCheckedUntil;
    draws.push({
      id: `draw-${date}`,
      date,
      played: true,
      lines: 1,
      costPerLine: 2.5,
      grossPrize: isKnownPrize ? 3.94 : 0,
      expenses: 0,
      notes: isKnownPrize ? "Premio importado del Excel original." : "",
      status: wasCheckedInExcel ? "manual" : "pending",
      checkedAt: wasCheckedInExcel ? new Date("2026-05-01T00:00:00.000Z").toISOString() : undefined,
    });
  }

  return draws;
}

export const initialState: AppState = {
  version: 1,
  config: {
    startDate: "2026-01-27",
    endDate: "2027-01-26",
    numbers: [7, 14, 17, 25, 33],
    stars: [4, 7],
    defaultCostPerLine: 2.5,
    defaultLines: 1,
    autoCheckOnOpen: true,
  },
  participants: [
    { id: "jose", name: "Jose", annualContribution: 120, extraContribution: 0 },
    { id: "david-c", name: "David C", annualContribution: 120, extraContribution: 0 },
    { id: "david-t", name: "David T", annualContribution: 120, extraContribution: 0 },
  ],
  draws: generateDraws("2026-01-27", "2027-01-26"),
  movements: [],
  logs: [],
};
