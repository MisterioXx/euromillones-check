import { Cloud, Download, LockKeyhole, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../types";
import { cloudRequest, type CloudSnapshot } from "../lib/cloud";
import { formatCurrency, totals } from "../lib/domain";
import { buildLog, exportState, getStorageIssue, importState } from "../lib/storage";
import { validateState } from "../lib/validation";
import { SectionHeader } from "./ui";

type User = { id: string; email: string; name: string };
type Props = { state: AppState; onStateChange: (state: AppState) => void; onModeChange?: (mode: "local" | "cloud") => void; onAttention?: (message: string | null) => void; onReady?: (ready: boolean) => void; disabled?: boolean };
type Backup = { id: string; revision: number; reason: string; createdAt: string };
const LINK_KEY = "euromillones-control:cloud-link";

export function CloudConnection({ state, onStateChange, onModeChange, onAttention, onReady, disabled = false }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [preview, setPreview] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<CloudSnapshot | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [daily, setDaily] = useState(true);
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState("");
  const [backups, setBackups] = useState<Backup[]>([]);
  const current = useRef(state);
  const callbacks = useRef({ onStateChange, onModeChange, onAttention, onReady });
  const disabledRef = useRef(disabled);
  const sessionRef = useRef<{ workspace: CloudSnapshot; acknowledged: string } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  current.current = state;
  callbacks.current = { onStateChange, onModeChange, onAttention, onReady };
  disabledRef.current = disabled;

  function remember(id: string, acknowledged: string) {
    try { localStorage.setItem(LINK_KEY, JSON.stringify({ id, acknowledged })); } catch { /* State storage reports quota errors separately. */ }
  }
  const pause = useCallback((reason?: string) => {
    sessionRef.current = null;
    setActive(false);
    callbacks.current.onModeChange?.("local");
    if (reason) { setError(reason); callbacks.current.onAttention?.(reason); }
  }, []);
  const adopt = useCallback((copy: CloudSnapshot, preserveLocal = true) => {
    if (disabledRef.current || getStorageIssue()) return;
    const checked = { ...copy, state: validateState(copy.state) };
    // importState keeps the previous browser data before changing the active copy.
    const next = preserveLocal ? importState(checked.state) : checked.state;
    sessionRef.current = { workspace: checked, acknowledged: JSON.stringify(checked.state) };
    setWorkspace(checked); setActive(true); setReviewed(false); setError("");
    callbacks.current.onStateChange(next);
    callbacks.current.onModeChange?.("cloud");
    callbacks.current.onAttention?.(null);
    remember(copy.id, JSON.stringify(checked.state));
  }, []);

  const loadWorkspace = useCallback(async (allowResume = false) => {
    const { workspace: remote } = await cloudRequest<{ workspace: CloudSnapshot | null }>("/api/cloud");
    if (remote) remote.state = validateState(remote.state);
    setWorkspace(remote);
    if (!remote) return;
    if (allowResume && !disabledRef.current && !getStorageIssue()) {
      try {
        const previous = JSON.parse(localStorage.getItem(LINK_KEY) ?? "null");
        if (previous?.id === remote.id && previous.acknowledged === JSON.stringify(current.current)) { adopt(remote, false); return; }
      } catch { /* An unreadable link never authorizes replacing local data. */ }
    }
    callbacks.current.onAttention?.("Hay una copia compartida disponible. Revisa ambas copias en Ajustes para continuar sin perder cambios locales.");
  }, [adopt]);

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      try {
        const status = await cloudRequest<{ configured: boolean; scheduler: string }>("/api/cloud?action=status");
        if (cancelled) return;
        setConfigured(status.configured); setPreview(status.scheduler !== "daily");
        if (!status.configured) return;
        const session = await cloudRequest<{ user?: User } | null>("/api/auth/get-session");
        if (cancelled) return;
        setUser(session?.user ?? null);
        if (session?.user) await loadWorkspace(true);
      } catch (cause) { if (!cancelled) { const text = cause instanceof Error ? cause.message : "No se pudo comprobar la conexión."; setError(text); if (localStorage.getItem(LINK_KEY)) callbacks.current.onAttention?.(text); } }
      finally { if (!cancelled) callbacks.current.onReady?.(true); }
    }
    void initialise();
    return () => { cancelled = true; };
  }, [loadWorkspace]);

  // One serialized writer. Every update carries the revision that was read.
  useEffect(() => {
    if (!active || disabled || getStorageIssue()) return;
    const timer = window.setTimeout(async () => {
      const session = sessionRef.current;
      if (!session || inFlight.current) return;
      const outgoing = current.current;
      const serialized = JSON.stringify(outgoing);
      if (serialized === session.acknowledged) return;
      inFlight.current = true; setSaving(true);
      const epoch = generation.current;
      try {
        const result = await cloudRequest<{ workspace: CloudSnapshot }>("/api/cloud", { state: outgoing, workspaceId: session.workspace.id, revision: session.workspace.revision }, "PUT");
        if (generation.current !== epoch || sessionRef.current !== session) return;
        sessionRef.current = { workspace: result.workspace, acknowledged: serialized };
        setWorkspace(result.workspace); remember(result.workspace.id, serialized); setMessage("Cambios guardados en la copia compartida.");
      } catch (cause) {
        if (generation.current !== epoch) return;
        const text = cause instanceof Error ? cause.message : "La sincronización se ha detenido. La copia local se conserva.";
        pause(text);
        callbacks.current.onStateChange({ ...current.current, logs: [buildLog("error", "Sincronización compartida detenida.", text), ...current.current.logs] });
      } finally { inFlight.current = false; setSaving(false); }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state, active, disabled, workspace?.revision, saving, pause]);

  useEffect(() => {
    if (!active) return;
    async function refresh() {
      const session = sessionRef.current;
      if (!session || inFlight.current || disabledRef.current || getStorageIssue() || document.visibilityState !== "visible" || JSON.stringify(current.current) !== session.acknowledged) return;
      const before = session.acknowledged;
      const epoch = generation.current;
      try {
        const { workspace: remote } = await cloudRequest<{ workspace: CloudSnapshot }>("/api/cloud");
        if (epoch !== generation.current || sessionRef.current !== session || inFlight.current || disabledRef.current || JSON.stringify(current.current) !== before) return;
        if (!remote) { pause("La cuenta ya no tiene una copia compartida disponible."); return; }
        if (remote.id !== session.workspace.id) { pause("La sesión ha cambiado de espacio compartido en otra pestaña. Se conserva tu copia local. Recarga la aplicación para revisar la conexión."); return; }
        if (remote.revision !== session.workspace.revision) {
          const next = validateState(remote.state);
          // No local edits since the request: the newer server copy can be adopted.
          sessionRef.current = { workspace: remote, acknowledged: JSON.stringify(next) };
          callbacks.current.onStateChange(next); remember(remote.id, JSON.stringify(next));
        }
        setWorkspace(remote);
      } catch (cause) { pause(cause instanceof Error ? cause.message : "No se ha podido actualizar la copia compartida."); }
    }
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [active, pause]);

  async function operation(run: () => Promise<void>) {
    if (busy || saving || disabledRef.current || getStorageIssue()) return;
    setBusy(true); setError(""); setMessage("");
    try { await run(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  const locked = busy || saving || disabled;
  const localTotals = totals(state);
  const remoteTotals = workspace ? totals(workspace.state) : null;
  return <section className="panel cloud-panel">
    <SectionHeader title="Conexión compartida" description="Una copia privada para compartir las cuentas y comprobar sorteos con la app cerrada."><span className="icon-tile"><Cloud size={21} /></span></SectionHeader>
    {preview && configured && <div className="notice warning"><p>Entorno de vista previa. Puedes probar la sincronización; la tarea diaria se activará cuando apruebes la publicación en producción.</p></div>}
    {error && <div className="notice danger" role="alert"><p>{error}</p></div>}
    {message && <p role="status" className="form-hint">{message}</p>}
    {configured === null && <p>Comprobando conexión…</p>}
    {configured === false && <p>La conexión compartida todavía no está configurada en este entorno. Tus datos siguen guardados en este navegador.</p>}
    {configured && !user && <form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void operation(async () => {
      await cloudRequest(`/api/auth/${signup ? "sign-up" : "sign-in"}/email`, { email, password, ...(signup ? { name } : {}) });
      setPassword("");
      const session = await cloudRequest<{ user: User }>("/api/auth/get-session");
      setUser(session.user); await loadWorkspace();
    }); }}>
      <p><LockKeyhole size={16} /> {signup ? "Crea tu cuenta privada. Puedes acceder a datos compartidos con un código de invitación." : "Entra para recuperar tu copia compartida desde cualquier dispositivo."}</p>
      <div className="form-grid">{signup && <label>Tu nombre<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}<label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Contraseña<input type="password" required minLength={12} maxLength={128} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /><small>Al menos 12 caracteres.{signup ? " Conserva tu contraseña: aún no hay recuperación por correo." : ""}</small></label></div>
      <div className="form-actions"><button className="button primary" disabled={locked}>{signup ? "Crear cuenta" : "Entrar"}</button><button type="button" className="button secondary" onClick={() => setSignup(!signup)} disabled={locked}>{signup ? "Ya tengo cuenta" : "Crear una cuenta"}</button></div>
    </form>}
    {user && <div className="dashboard-stack">
      <div className="cloud-account"><p><strong>{user.name}</strong><br /><span>{user.email}</span></p><button className="button secondary small" disabled={locked} onClick={() => void operation(async () => {
        if (sessionRef.current && JSON.stringify(current.current) !== sessionRef.current.acknowledged) throw new Error("Espera a que se guarden los cambios antes de salir.");
        await cloudRequest("/api/auth/sign-out", {}); generation.current += 1; pause(); setUser(null); setWorkspace(null); setInvitation(""); callbacks.current.onAttention?.(null);
      })}>Cerrar sesión</button></div>
      {!workspace && <><h3>Activar la copia compartida</h3><p>Se copiarán {state.draws.length} sorteos, {state.participants.length} participantes y {state.movements.length} movimientos. Saldo actual: <strong>{formatCurrency(localTotals.balanceToDate)}</strong>.</p><p>En una vista previa, los datos del navegador de producción no aparecen automáticamente. Importa primero tu JSON actualizado si quieres probar con esa copia.</p><button className="button secondary" disabled={locked} onClick={() => exportState(state)}><Download size={16} />Descargar copia local</button><label className="checkbox-row"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={locked} /><span>He revisado el saldo y quiero guardar estos datos en mi copia compartida privada. Se conservarán los originales y una copia de la migración.</span></label><label className="checkbox-row"><input type="checkbox" checked={daily} onChange={(event) => setDaily(event.target.checked)} disabled={locked} /><span>Comprobar los pendientes cada día con la app cerrada{preview ? " al publicar en producción" : ""}.</span></label><button className="button primary" disabled={!reviewed || locked} onClick={() => void operation(async () => {
        const before = JSON.stringify(current.current);
        const result = await cloudRequest<{ workspace: CloudSnapshot }>("/api/cloud?action=create", { state: current.current, expectedUserId: user.id, confirmMigration: true, backgroundEnabled: daily });
        setWorkspace(result.workspace);
        if (before !== JSON.stringify(current.current) || disabledRef.current) { setReviewed(false); callbacks.current.onAttention?.("Tus datos locales han cambiado. Revisa ambas copias en Ajustes antes de conectarlas."); return; }
        adopt(result.workspace);
      })}>Crear copia compartida</button><hr /><form className="stacked-form" onSubmit={(event) => { event.preventDefault(); void operation(async () => { const result = await cloudRequest<{ workspace: CloudSnapshot }>("/api/cloud?action=join", { token: token.trim(), expectedUserId: user.id }); setWorkspace(result.workspace); setReviewed(false); callbacks.current.onAttention?.("Revisa la copia compartida en Ajustes antes de abrirla."); }); }}><label>¿Tienes un código de invitación?<input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Código de invitación" /></label><button className="button secondary" disabled={!token.trim() || locked}>Usar invitación</button></form></>}
      {workspace && !active && <><h3>Revisa las dos copias</h3><div className="form-grid"><div><strong>En este dispositivo</strong><p>{state.draws.length} sorteos · {formatCurrency(localTotals.balanceToDate)}</p><button className="button secondary small" disabled={locked} onClick={() => exportState(state)}>Descargar copia local</button></div><div><strong>En la copia compartida</strong><p>{workspace.state.draws.length} sorteos · {formatCurrency(remoteTotals!.balanceToDate)}</p><button className="button secondary small" onClick={() => exportState(workspace.state)}>Descargar copia compartida</button></div></div><p>Abre la copia compartida para continuar. Se guardará una copia local de lo que hay ahora; si contiene cambios que quieras mantener, descárgala y revísalos antes.</p><label className="checkbox-row"><input type="checkbox" checked={reviewed} disabled={locked} onChange={(event) => setReviewed(event.target.checked)} /><span>He revisado ambas copias y quiero abrir la compartida.</span></label><div className="form-actions"><button className="button primary" disabled={!reviewed || locked} onClick={() => void operation(async () => { const before = JSON.stringify(current.current); const result = await cloudRequest<{ workspace: CloudSnapshot }>("/api/cloud"); if (before !== JSON.stringify(current.current) || disabledRef.current) { setWorkspace(result.workspace); setReviewed(false); throw new Error("Tus datos locales han cambiado. Revisa ambas copias antes de abrir la compartida."); } if (result.workspace.id !== workspace.id) { throw new Error("La sesión ha cambiado de espacio compartido. Se conserva tu copia local; recarga la aplicación para revisar la conexión."); } if (result.workspace.revision !== workspace.revision) { setWorkspace(result.workspace); setReviewed(false); throw new Error("La copia compartida ha cambiado. Revisa su saldo actualizado antes de abrirla."); } adopt(result.workspace); })}>Abrir copia compartida</button><button className="button secondary" disabled={locked} onClick={() => void operation(() => loadWorkspace())}><RefreshCw size={16} />Volver a consultar</button></div></>}
      {workspace && active && <><div className="notice success" role="status"><p>{saving ? "Guardando cambios…" : "Conexión compartida activa"}. Versión {workspace.revision}.<br />Última actualización: {new Date(workspace.updatedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}.</p></div><label className="toggle-row"><span><strong>Comprobación diaria</strong><small>{preview ? "Preparada para producción: entre las 06:00 y las 07:00 en verano; entre las 05:00 y las 06:00 en invierno (Madrid)." : "Cada mañana: entre las 06:00 y las 07:00 en verano; entre las 05:00 y las 06:00 en invierno (Madrid)."}{workspace.lastCheckedAt ? ` Última ejecución: ${new Date(workspace.lastCheckedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}.` : " Aún no se ha ejecutado en segundo plano."}</small></span><input type="checkbox" checked={workspace.backgroundEnabled} disabled={locked || !workspace.isOwner} onChange={(event) => { const enabled = event.target.checked; void operation(async () => { await cloudRequest("/api/cloud?action=schedule", { enabled, workspaceId: workspace.id }); setWorkspace({ ...workspace, backgroundEnabled: enabled }); if (sessionRef.current) sessionRef.current.workspace.backgroundEnabled = enabled; }); }} /></label><p className="form-hint">Los premios se incorporan una sola vez y solo con importe contrastado. Los errores y discrepancias se conservan en Logs.</p>
        {workspace.isOwner && <div><button className="button secondary" disabled={locked} onClick={() => void operation(async () => { const result = await cloudRequest<{ token: string }>("/api/cloud?action=invite", { workspaceId: workspace.id }); setInvitation(result.token); })}>Crear invitación para otra persona</button>{invitation && <label className="stacked-form">Código de un solo uso · válido 7 días<input value={invitation} readOnly onFocus={(event) => event.target.select()} /><small>Compártelo únicamente con quien deba acceder a estos datos.</small></label>}</div>}
        <div><button className="button secondary" disabled={locked} onClick={() => void operation(async () => { const result = await cloudRequest<{ backups: Backup[] }>("/api/cloud?action=backups"); setBackups(result.backups); })}>Ver copias anteriores</button>{backups.length > 0 && <ul className="cloud-backups">{backups.map((backup) => <li key={backup.id}><span>{backup.reason === "import" ? "Migración original" : `Versión ${backup.revision}`} · {new Date(backup.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</span><button className="button secondary small" disabled={locked} onClick={() => void operation(async () => { const result = await cloudRequest<{ state: AppState }>(`/api/cloud?action=backup&id=${encodeURIComponent(backup.id)}`); exportState(validateState(result.state)); })}>Descargar</button></li>)}</ul>}</div>
      </>}
    </div>}
  </section>;
}
