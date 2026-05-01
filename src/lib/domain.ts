import { AppState, DrawEntry } from "../types";
import { isPastOrToday, todayIso } from "./dates";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function drawCost(draw: DrawEntry): number {
  return draw.played ? draw.lines * draw.costPerLine : 0;
}

export function drawNetPrize(draw: DrawEntry): number {
  return Math.max(0, draw.grossPrize - draw.expenses);
}

export function totals(state: AppState, today = todayIso()) {
  const contributionTotal = state.participants.reduce(
    (sum, participant) => sum + participant.annualContribution + participant.extraContribution,
    0,
  );
  const currentDraws = state.draws.filter((draw) => isPastOrToday(draw.date, today));
  const spentToDate = currentDraws.reduce((sum, draw) => sum + drawCost(draw), 0);
  const plannedSpend = state.draws.reduce((sum, draw) => sum + drawCost(draw), 0);
  const prizesToDate = currentDraws.reduce((sum, draw) => sum + drawNetPrize(draw), 0);
  const allPrizes = state.draws.reduce((sum, draw) => sum + drawNetPrize(draw), 0);
  const adjustmentsToDate = state.movements
    .filter((movement) => movement.date <= today)
    .reduce((sum, movement) => sum + movement.amount, 0);
  const balanceToDate = contributionTotal + prizesToDate + adjustmentsToDate - spentToDate;
  const projectedBalance =
    contributionTotal +
    allPrizes +
    state.movements.reduce((sum, movement) => sum + movement.amount, 0) -
    plannedSpend;

  return {
    contributionTotal,
    spentToDate,
    plannedSpend,
    prizesToDate,
    allPrizes,
    adjustmentsToDate,
    balanceToDate,
    projectedBalance,
    drawsPlayedToDate: currentDraws.filter((draw) => draw.played).length,
    totalDraws: state.draws.length,
  };
}

export function getLatestPlayableDraw(state: AppState, today = todayIso()): DrawEntry | undefined {
  return [...state.draws]
    .filter((draw) => draw.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function countMatches(
  ownNumbers: number[],
  ownStars: number[],
  winningNumbers: number[],
  winningStars: number[],
) {
  const numberHits = ownNumbers.filter((number) => winningNumbers.includes(number)).length;
  const starHits = ownStars.filter((star) => winningStars.includes(star)).length;
  return { numberHits, starHits };
}

export function categoryLabel(numberHits: number, starHits: number): string {
  if (numberHits === 5 && starHits === 2) return "1a categoria";
  if (numberHits === 5 && starHits === 1) return "2a categoria";
  if (numberHits === 5) return "3a categoria";
  if (numberHits === 4 && starHits === 2) return "4a categoria";
  if (numberHits === 4 && starHits === 1) return "5a categoria";
  if (numberHits === 3 && starHits === 2) return "6a categoria";
  if (numberHits === 4) return "7a categoria";
  if (numberHits === 2 && starHits === 2) return "8a categoria";
  if (numberHits === 3 && starHits === 1) return "9a categoria";
  if (numberHits === 3) return "10a categoria";
  if (numberHits === 1 && starHits === 2) return "11a categoria";
  if (numberHits === 2 && starHits === 1) return "12a categoria";
  if (numberHits === 2) return "13a categoria";
  return "Sin premio";
}
