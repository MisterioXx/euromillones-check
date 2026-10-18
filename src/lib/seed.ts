import type { AppState, DrawEntry } from "../types.js";
import { parseIsoDate, toIsoDate } from "./dates.js";

function generateDraws(startDate: string, endDate: string): DrawEntry[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const draws: DrawEntry[] = [];

  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 2 && day !== 5) continue;

    const date = toIsoDate(cursor);
    const isKnownPrize = date === "2026-03-17";
    draws.push({
      id: `draw-${date}`,
      date,
      played: true,
      lines: 1,
      costPerLine: 2.5,
      grossPrize: isKnownPrize ? 3.94 : 0,
      expenses: 0,
      notes: isKnownPrize ? "Premio importado del Excel original." : "",
      status: isKnownPrize ? "manual" : "pending",
      prizeSource: isKnownPrize ? "imported" : undefined,
      betNumbers: [7, 14, 17, 25, 33],
      betStars: [4, 7],
    });
  }

  return draws;
}

export const initialState: AppState = {
  version: 2,
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
