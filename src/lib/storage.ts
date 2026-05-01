import { AppState, LogEntry } from "../types";
import { initialState } from "./seed";

const STORAGE_KEY = "euromillones-control:v1";
const IMPORTED_CHECKED_UNTIL = "2026-05-01";

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

export function loadState(): AppState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneState(initialState);
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return cloneState(initialState);
    return normalizeImportedState(parsed);
  } catch {
    return cloneState(initialState);
  }
}

function normalizeImportedState(state: AppState): AppState {
  const hasImportMigrationLog = state.logs.some(
    (log) => log.message === "Sorteos importados marcados como revisados.",
  );

  if (hasImportMigrationLog) return state;

  const draws = state.draws.map((draw) => {
    const shouldMarkAsReviewed =
      draw.date <= IMPORTED_CHECKED_UNTIL && draw.played && draw.status === "pending";
    if (!shouldMarkAsReviewed) return draw;
    return {
      ...draw,
      status: "manual" as const,
      checkedAt: new Date("2026-05-01T00:00:00.000Z").toISOString(),
      notes: draw.notes || "Sorteo importado del Excel original como ya revisado.",
    };
  });

  return {
    ...state,
    draws,
    logs: [
      buildLog(
        "info",
        "Sorteos importados marcados como revisados.",
        "Los sorteos jugados hasta el 01/05/2026 se han alineado con el Excel original.",
      ),
      ...state.logs,
    ].slice(0, 250),
  };
}

export function saveState(state: AppState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportState(state: AppState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `euromillones-control-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildLog(
  level: LogEntry["level"],
  message: string,
  details?: string,
): LogEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    level,
    message,
    details,
  };
}
