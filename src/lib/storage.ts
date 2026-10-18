import type { AppState, LogEntry } from "../types.js";
import { todayIso } from "./dates.js";
import { initialState } from "./seed.js";
import { validateState } from "./validation.js";

export const STORAGE_KEY = "euromillones-control:v2";
export const LEGACY_STORAGE_KEY = "euromillones-control:v1";
const FIRST_MIGRATION_BACKUP_KEY = "euromillones-control:backup:before-v2";
let storageIssue: string | null = null;
let writesBlocked = false;
let recoveryBackup: { key: string; raw: string } | null = null;

export type LocalBackup = { key: string; label: string; savedAt?: string; bytes: number };

function isBackupKey(key: string): boolean {
  return key === LEGACY_STORAGE_KEY || key.startsWith("euromillones-control:backup:");
}

export function listLocalBackups(): LocalBackup[] {
  const storage = window.localStorage;
  const backups: LocalBackup[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isBackupKey(key)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    backups.push({
      key,
      label: key === LEGACY_STORAGE_KEY ? "Original de la versión 1" : key === FIRST_MIGRATION_BACKUP_KEY
        ? "Antes de migrar a la versión 2" : key.includes(":import:") ? "Antes de una importación" : "Copia previa a la migración",
      savedAt: key.match(/:(\d{4}-\d{2}-\d{2}T[\d:.]+Z):/)?.[1],
      bytes: new TextEncoder().encode(raw).length,
    });
  }
  return backups.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? "") || a.label.localeCompare(b.label));
}

function localBackupRaw(key: string): string {
  if (!isBackupKey(key)) throw new Error("La clave no corresponde a una copia de EuroControl.");
  const raw = window.localStorage.getItem(key);
  if (raw === null) throw new Error("La copia de seguridad ya no está disponible en este navegador.");
  return raw;
}

/** Read and validate for preview; restoring still requires an explicit importState call. */
export function readLocalBackup(key: string): AppState {
  return validateState(JSON.parse(localBackupRaw(key)));
}

export function exportLocalBackup(key: string): void {
  downloadJson(localBackupRaw(key), `euromillones-copia-anterior-${todayIso()}.json`);
}

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido de almacenamiento.";
}

function activeStoredCopy(): { key: string; raw: string } | null {
  const current = window.localStorage.getItem(STORAGE_KEY);
  if (current !== null) return { key: STORAGE_KEY, raw: current };
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return legacy !== null ? { key: LEGACY_STORAGE_KEY, raw: legacy } : null;
}

function backupRaw(copy: { key: string; raw: string }, reason: "migration" | "import"): void {
  const originalBackup = window.localStorage.getItem(FIRST_MIGRATION_BACKUP_KEY);
  if (reason === "migration" && originalBackup === copy.raw) return;
  const key = reason === "migration" && originalBackup === null
    ? FIRST_MIGRATION_BACKUP_KEY
    : `euromillones-control:backup:${reason}:${new Date().toISOString()}:${crypto.randomUUID()}`;
  window.localStorage.setItem(key, copy.raw);
}

export function getStorageIssue(): string | null {
  return storageIssue;
}

export function getRecoveryBackup(): { key: string; raw: string } | null {
  return recoveryBackup ? { ...recoveryBackup } : null;
}

export function loadState(): AppState {
  storageIssue = null;
  writesBlocked = false;
  recoveryBackup = null;
  let copy: { key: string; raw: string } | null = null;
  try {
    copy = activeStoredCopy();
    if (!copy) return cloneState(initialState);
    const parsed: unknown = JSON.parse(copy.raw);
    const state = validateState(parsed);
    if ((parsed as { version: number }).version === 1) {
      backupRaw(copy, "migration");
      return {
        ...state,
        logs: [buildLog("info", "Copia local migrada a la versión 2.", "Se conserva intacta la versión 1 y una copia previa. Se mantienen importes, notas y registros. Los premios históricos sin una fuente fiable quedan pendientes de contrastar, conservando su importe. La jugada actual se ha guardado como referencia del histórico que no tenía combinación propia."), ...state.logs],
      };
    }
    return state;
  } catch (error) {
    writesBlocked = true;
    recoveryBackup = copy;
    storageIssue = `No se han podido cargar tus datos. Se conserva el original y el guardado está bloqueado hasta recuperar o importar una copia válida. ${errorMessage(error)}`;
    return {
      ...cloneState(initialState),
      logs: [buildLog("error", "Datos locales pendientes de recuperación.", storageIssue)],
    };
  }
}

export function saveState(state: AppState): void {
  if (writesBlocked) throw new Error(storageIssue ?? "Guardado bloqueado para proteger los datos originales.");
  try {
    const validated = validateState(state);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      try {
        validateState(JSON.parse(raw));
      } catch (error) {
        recoveryBackup = { key: STORAGE_KEY, raw };
        writesBlocked = true;
        throw new Error(`La copia guardada ha cambiado o está dañada. No se sobrescribirá. ${errorMessage(error)}`);
      }
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    storageIssue = null;
  } catch (error) {
    storageIssue = errorMessage(error);
    throw new Error(storageIssue);
  }
}

/** Call only after the user has reviewed the proposed import; never erase the previous copy first. */
export function importState(input: unknown): AppState {
  const state = validateState(typeof input === "string" ? JSON.parse(input) : input);
  const copy = activeStoredCopy();
  if (copy) backupRaw(copy, "import");
  const imported: AppState = {
    ...state,
    logs: [buildLog("info", "Copia de datos importada.", copy ? "Se ha guardado una copia de seguridad antes de sustituir los datos locales." : "Primera copia guardada en este dispositivo."), ...state.logs],
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
  storageIssue = null;
  writesBlocked = false;
  recoveryBackup = null;
  return imported;
}

function downloadJson(raw: string, filename: string): void {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportState(state: AppState): void {
  downloadJson(JSON.stringify(state, null, 2), `euromillones-control-${todayIso()}.json`);
}

export function exportRecoveryBackup(): void {
  if (!recoveryBackup) throw new Error("No hay una copia original pendiente de recuperación.");
  downloadJson(recoveryBackup.raw, `euromillones-original-recuperacion-${todayIso()}.json`);
}

export function buildLog(level: LogEntry["level"], message: string, details?: string): LogEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), level, message, details };
}
