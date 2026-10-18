import { AlertCircle, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronRight, CircleHelp, Clock3, History, LayoutDashboard, LoaderCircle, RefreshCw, Settings, Sparkles, Ticket, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, DrawEntry, LogEntry } from "./types";
import { formatDate, isResultDue, todayIso } from "./lib/dates";
import { drawNetPrize, formatCurrency, totals } from "./lib/domain";
import { checkOfficialResults } from "./lib/official";
import { applyCheckResult, getPendingDraws } from "./lib/reconciliation";
import { buildLog, exportState, getStorageIssue, loadState, saveState } from "./lib/storage";
import { CashView } from "./components/CashView";
import { DrawDetail, DrawsView } from "./components/DrawsView";
import { SettingsView } from "./components/SettingsView";
import { validateState } from "./lib/validation";
import { CloudConnection } from "./components/CloudConnection";
import { Combination, EmptyState, SectionHeader, StatusBadge, TextLink } from "./components/ui";

type Tab = "summary" | "draws" | "cash" | "settings" | "logs";
type Notice = { tone: "success" | "warning" | "danger"; text: string };
const primaryTabs = [{ id: "summary", label: "Resumen", icon: LayoutDashboard }, { id: "draws", label: "Sorteos", icon: Ticket }, { id: "cash", label: "Caja", icon: Wallet }] as const;
const titles: Record<Tab, { title: string; description: string }> = {
  summary: { title: "Resumen de Euromillones", description: "Sorteos, premios y saldo, en un mismo lugar." },
  draws: { title: "Cada sorteo cuenta.", description: "Resultados, premios y comprobaciones del ciclo actual." },
  cash: { title: "Las cuentas, claras.", description: "Aportaciones, premios y movimientos de caja." },
  settings: { title: "Configuración", description: "Jugada, participantes, copias de seguridad y conexión compartida." },
  logs: { title: "Todo queda registrado.", description: "Comprobaciones, avisos y cambios que conviene conocer." },
};

export function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [tab, setTab] = useState<Tab>(() => { const value = location.hash.slice(1); return value in titles ? value as Tab : "summary"; });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [storageIssue, setStorageIssue] = useState<string | null>(getStorageIssue);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudAttention, setCloudAttention] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<"local" | "cloud">("local");
  const [progress, setProgress] = useState<{ done: number; total: number; date: string; errors: number } | null>(null);
  const [selectedDraw, setSelectedDraw] = useState<string | null>(null);
  const [drawFilter, setDrawFilter] = useState<"recent" | "pending" | "prizes" | "all">("recent");
  const [clock, setClock] = useState(() => Date.now());
  const stateRef = useRef(state);
  const checkingRef = useRef(false);
  const stopRef = useRef(false);
  const lastAutoRef = useRef(0);
  const mountedRef = useRef(true);
  stateRef.current = state;
  const busy = progress !== null;
  const summary = useMemo(() => totals(state), [state, clock]);
  const pending = useMemo(() => getPendingDraws(state), [state, clock]);
  const selected = state.draws.find((draw) => draw.id === selectedDraw);

  const changeState = useCallback((next: AppState | ((current: AppState) => AppState)) => {
    setState((current) => { const updated = typeof next === "function" ? next(current) : next; stateRef.current = updated; return updated; });
  }, []);
  const replaceState = useCallback((next: AppState) => changeState(next), [changeState]);
  const navigate = useCallback((next: Tab) => { setTab(next); history.replaceState(null, "", `#${next}`); window.scrollTo({ top: 0, behavior: "instant" }); }, []);

  useEffect(() => {
    try { saveState(state); setStorageIssue(null); } catch (error) { setStorageIssue(error instanceof Error ? error.message : "No se han podido guardar los datos en este dispositivo."); }
  }, [state]);
  useEffect(() => {
    mountedRef.current = true;
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    const hash = () => { const value = location.hash.slice(1); if (value in titles) setTab(value as Tab); };
    window.addEventListener("hashchange", hash);
    return () => { mountedRef.current = false; window.clearInterval(interval); window.removeEventListener("hashchange", hash); };
  }, []);

  const runChecks = useCallback(async (drawId?: string, automatic = false, reviewAll = false) => {
    if (!cloudReady || checkingRef.current || getStorageIssue()) return;
    const current = stateRef.current;
    const queue = drawId
      ? current.draws.filter((draw) => draw.id === drawId && draw.played && isResultDue(draw.date))
      : reviewAll
        ? current.draws.filter((draw) => draw.played && isResultDue(draw.date)).sort((a, b) => a.date.localeCompare(b.date))
        : getPendingDraws(current);
    if (!queue.length) { if (!automatic) setNotice({ tone: "success", text: "Todo al día. No hay sorteos pendientes con resultado esperado." }); return; }
    checkingRef.current = true;
    stopRef.current = false;
    setNotice(null);
    let done = 0;
    let errors = 0;
    setProgress({ done, total: queue.length, date: queue[0].date, errors });
    try {
      for (const draw of queue) {
        if (stopRef.current || !mountedRef.current) break;
        setProgress({ done, total: queue.length, date: draw.date, errors });
        try {
          const result = await checkOfficialResults(draw.date);
          const next = applyCheckResult(stateRef.current, draw.id, result);
          if (next.draws.find((entry) => entry.id === draw.id)?.status === "error") errors += 1;
          if (mountedRef.current) changeState(next);
        } catch (error) {
          errors += 1;
          const message = error instanceof Error ? error.message : "No se pudo conectar con la fuente.";
          if (mountedRef.current) changeState((latest) => applyCheckResult(latest, draw.id, { ok: false, source: "", fetchedAt: new Date().toISOString(), requestedDate: draw.date, message }));
        }
        done += 1;
        if (mountedRef.current) setProgress({ done, total: queue.length, date: draw.date, errors });
      }
      if (mountedRef.current) {
        changeState((latest) => ({ ...latest, logs: [buildLog(errors ? "warning" : "info", stopRef.current ? "Comprobación pausada por el usuario." : "Comprobación de sorteos terminada.", `${done} consultados; ${errors} con error. Los importes sin confirmar siguen pendientes.`), ...latest.logs] }));
        setNotice({ tone: errors ? "warning" : "success", text: `${done} ${done === 1 ? "sorteo consultado" : "sorteos consultados"}${errors ? ` · ${errors} con error. Puedes reintentarlos; el detalle está en Logs.` : ". Los premios con importe confirmado ya se reflejan en el saldo."}` });
      }
    } finally { checkingRef.current = false; if (mountedRef.current) setProgress(null); }
  }, [changeState, cloudReady]);

  useEffect(() => {
    if (!cloudReady || cloudAttention || !state.config.autoCheckOnOpen || storageIssue) return;
    const check = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || Date.now() - lastAutoRef.current < 15 * 60_000) return;
      lastAutoRef.current = Date.now();
      void runChecks(undefined, true);
    };
    check();
    const interval = window.setInterval(check, 15 * 60_000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(interval); window.removeEventListener("online", check); document.removeEventListener("visibilitychange", check); };
  }, [state.config.autoCheckOnOpen, storageIssue, cloudReady, cloudAttention, runChecks]);

  const saveDraw = (draw: DrawEntry, original: DrawEntry) => {
    const current = stateRef.current;
    if (JSON.stringify(current.draws.find((item) => item.id === draw.id)) !== JSON.stringify(original)) throw new Error("Este sorteo ha cambiado mientras lo editabas. Cancela y vuelve a abrir la edición para revisar los datos actuales.");
    const next = validateState({ ...current, draws: current.draws.map((item) => item.id === draw.id ? draw : item), logs: [buildLog("info", `Sorteo del ${formatDate(draw.date)} actualizado manualmente.`, "Se han guardado los datos revisados y se ha recalculado el saldo."), ...current.logs] });
    changeState(next);
    setSelectedDraw(null);
    setNotice({ tone: "success", text: "Cambios guardados. El saldo se ha actualizado." });
  };
  const openPending = () => { setDrawFilter("pending"); navigate("draws"); };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Ir al contenido</a>
    <header className="app-header"><div className="header-inner">
      <button className="brand" onClick={() => navigate("summary")} aria-label="EuroControl, ir al resumen"><span className="brand-mark"><Sparkles size={23} /></span><span>Euro<span className="brand-light">Control</span></span></button>
      <nav className="main-nav" aria-label="Secciones principales">{primaryTabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "nav-item active" : "nav-item"} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={17} /><span>{label}</span>{id === "draws" && pending.length > 0 && <span className="nav-count" aria-label={`${pending.length} pendientes`}>{pending.length}</span>}</button>)}</nav>
      <nav className="secondary-nav" aria-label="Herramientas"><button className={`icon-button ${tab === "logs" ? "active" : ""}`} onClick={() => navigate("logs")} aria-label="Logs e incidencias" aria-current={tab === "logs" ? "page" : undefined} title="Logs e incidencias"><History size={20} /><span className="sr-only">Logs</span></button><button className={`icon-button ${tab === "settings" ? "active" : ""}`} onClick={() => navigate("settings")} aria-label="Ajustes" aria-current={tab === "settings" ? "page" : undefined} title="Ajustes"><Settings size={20} /></button></nav>
    </div></header>
    <main id="main-content" className="main-content">
      <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line" />TEMPORADA {state.config.startDate.slice(0, 4)} — {state.config.endDate.slice(0, 4)}</div><h1>{titles[tab].title}</h1><p>{titles[tab].description}</p></div><div className="page-actions"><span className={`storage-indicator ${storageMode}`}><span className="status-dot" />{storageMode === "cloud" ? "Datos compartidos" : "En este dispositivo"}</span><button className="button primary" disabled={busy || !cloudReady || !!storageIssue} onClick={() => void runChecks()}>{busy ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}<span>{!cloudReady ? "Preparando…" : busy ? "Comprobando…" : "Actualizar resultados"}</span></button></div></div>
      {storageIssue && <div className="notice danger" role="alert"><AlertCircle size={20} /><div><strong>Los datos necesitan atención</strong><p>{storageIssue}</p><button className="text-link" onClick={() => navigate("settings")}>Revisar copias y recuperación<ChevronRight size={15} /></button></div></div>}
      {cloudAttention && <div className="notice warning" role="status"><AlertCircle size={20} /><div><p>{cloudAttention}</p><button className="text-link" onClick={() => navigate("settings")}>Revisar conexión compartida<ChevronRight size={15} /></button></div></div>}
      {notice && <div className={`notice ${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>{notice.tone === "success" ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}<p>{notice.text}</p><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><X size={17} /></button></div>}
      {progress && <div className="check-progress" role="status" aria-live="polite"><div><LoaderCircle size={17} className="spin" /><strong>Consultando {formatDate(progress.date)}</strong><span>{progress.done} de {progress.total}</span><button className="text-link" onClick={() => { stopRef.current = true; }}>Detener al terminar este sorteo</button></div><progress value={progress.done} max={progress.total} aria-label="Progreso de comprobación" /></div>}
      {!storageIssue && tab === "summary" && <Dashboard state={state} summary={summary} pending={pending} onPending={openPending} onDraw={setSelectedDraw} onDraws={() => navigate("draws")} onCash={() => navigate("cash")} />}
      {!storageIssue && tab === "draws" && <DrawsView state={state} filter={drawFilter} onFilter={setDrawFilter} onSelect={setSelectedDraw} onReviewAll={() => void runChecks(undefined, false, true)} checksDisabled={busy || !cloudReady || !!storageIssue} />}
      {!storageIssue && tab === "cash" && <CashView state={state} onChange={changeState} disabled={busy} />}
      {(tab === "settings" || !!storageIssue) && <SettingsView key={JSON.stringify([state.config, state.participants])} state={state} onChange={replaceState} disabled={busy} recoveryOnly={!!storageIssue} onNotice={(text, tone = "success") => setNotice({ text, tone })} />}
      <section hidden={tab !== "settings"} className="cloud-section"><CloudConnection state={state} onStateChange={replaceState} onModeChange={setStorageMode} disabled={busy || !!storageIssue} onAttention={setCloudAttention} onReady={setCloudReady} /></section>
      {tab === "logs" && <LogsView logs={state.logs} />}
      <footer className="app-footer"><span><Sparkles size={14} />EuroControl · Sorteos y cuentas al día.</span><span>{storageMode === "cloud" ? "Conexión compartida activada" : "Guardado local en este navegador"}<span className="footer-dot">·</span><button disabled={!!storageIssue} onClick={() => exportState(state)}><ArrowDownToLine size={14} />Exportar copia</button></span></footer>
    </main>
    {selected && <DrawDetail key={selected.id} draw={selected} config={state.config} onClose={() => setSelectedDraw(null)} onSave={saveDraw} onCheck={() => { const id = selected.id; setSelectedDraw(null); void runChecks(id); }} busy={busy || !cloudReady} />}
  </div>;
}

function Dashboard({ state, summary, pending, onPending, onDraw, onDraws, onCash }: { state: AppState; summary: ReturnType<typeof totals>; pending: DrawEntry[]; onPending: () => void; onDraw: (id: string) => void; onDraws: () => void; onCash: () => void }) {
  const today = todayIso();
  const recent = [...state.draws].filter((draw) => draw.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const next = state.draws.filter((draw) => !isResultDue(draw.date)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const latest = recent[0];
  const latestChecked = recent.find((draw) => draw.winningNumbers?.length && draw.winningStars?.length);
  const unpriced = state.draws.filter((draw) => draw.status === "awaiting-prize").length;
  const lastCheck = state.draws.map((draw) => draw.lastAttemptAt ?? draw.checkedAt).filter((value): value is string => !!value).sort().slice(-1)[0];
  const lastPrize = recent.find((draw) => drawNetPrize(draw) > 0);
  const spentPercent = summary.contributionTotal > 0 ? Math.min(100, Math.max(0, summary.spentToDate / summary.contributionTotal * 100)) : 0;
  return <div className="dashboard-stack">
    <div className="overview-grid"><section className="balance-card"><div className="balance-card-top"><span className="eyebrow">SALDO ACTUAL</span><span className="light-pill"><Wallet size={14} />Caja</span></div><div className="balance-amount">{formatCurrency(summary.balanceToDate)}</div><p>Balance de aportaciones, premios, gastos y ajustes.</p><div className="balance-rule" /><div className="balance-bottom"><div><span>Saldo previsto al {formatDate(state.config.endDate)}</span><strong>{formatCurrency(summary.projectedBalance)}</strong></div><button className="light-link" onClick={onCash}>Ver las cuentas<ArrowUpRight size={18} /></button></div></section>
      <section className="panel combination-panel"><div className="section-label"><span className="icon-tile"><Ticket size={19} /></span><span>JUGADA FIJA</span><span className="badge neutral">Fija</span></div><h2>Combinación actual</h2><Combination numbers={state.config.numbers} stars={state.config.stars} /><div className="combination-legend"><span>5 números</span><span>2 estrellas</span></div><div className="next-draw"><div className="calendar-tile"><span>{next ? new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "Europe/Madrid" }).format(new Date(`${next.date}T12:00:00Z`)).replace(".", "").toUpperCase() : "FIN"}</span><strong>{next ? next.date.slice(8) : "—"}</strong></div><div><span>Próximo sorteo</span><strong>{next ? formatDate(next.date) : "Ciclo finalizado"}</strong><small>{next ? "La apuesta se registra automáticamente" : "Amplía el periodo desde Ajustes"}</small></div><Clock3 size={18} className="muted" /></div></section></div>
    <div className="metrics-row"><Metric label="Aportaciones" value={formatCurrency(summary.contributionTotal)} detail={`${state.participants.length} participantes`} icon={<Wallet size={17} />} /><Metric label="Gastado en sorteos" value={formatCurrency(summary.spentToDate)} detail={`${summary.drawsPlayedToDate} sorteos hasta hoy`} icon={<Ticket size={17} />} /><Metric label="Premios netos" value={formatCurrency(summary.prizesToDate)} detail={unpriced ? `${unpriced} ${unpriced === 1 ? "importe por confirmar" : "importes por confirmar"}` : "Importes registrados en caja"} icon={<Sparkles size={17} />} /><Metric label="Gasto total previsto" value={formatCurrency(summary.plannedSpend)} detail={`Hasta ${formatDate(state.config.endDate)}`} icon={<History size={17} />} /></div>
    <section className={`reconciliation-banner ${pending.length ? "needs-attention" : "all-clear"}`}><span className="reconciliation-icon">{pending.length ? <Clock3 size={22} /> : <CheckCircle2 size={22} />}</span><div><h2>{pending.length ? `${pending.length} ${pending.length === 1 ? "sorteo necesita" : "sorteos necesitan"} una revisión` : "Los resultados están al día"}</h2><p>{pending.length ? `El saldo incluye solo los premios registrados.${unpriced ? ` Hay ${unpriced} con el importe pendiente.` : " Actualiza para consultar los que faltan."}` : "Las nuevas comprobaciones se reflejarán aquí."}</p>{lastCheck && <small>Última consulta: {new Date(lastCheck).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small>}</div>{pending.length > 0 && <button className="button secondary" onClick={onPending}>Revisar pendientes<ChevronRight size={16} /></button>}</section>
    <div className="dashboard-bottom"><section className="panel"><SectionHeader title="Últimos sorteos" description="El historial más reciente de la jugada."><TextLink onClick={onDraws}>Ver todos</TextLink></SectionHeader>{recent.length ? <div className="recent-list">{recent.slice(0, 4).map((draw) => <button className="recent-draw" key={draw.id} onClick={() => onDraw(draw.id)}><span className="draw-date-icon"><Ticket size={19} /></span><span className="recent-draw-date"><strong>{formatDate(draw.date)}</strong><StatusBadge draw={draw} /></span><span className={`recent-prize ${drawNetPrize(draw) > 0 ? "positive" : ""}`}>{draw.status === "awaiting-prize" && draw.grossPrize === 0 ? "Por confirmar" : drawNetPrize(draw) > 0 ? `+${formatCurrency(drawNetPrize(draw))}` : draw.status === "checked" || draw.status === "manual" ? "Sin premio registrado" : "—"}</span><ChevronRight size={17} /></button>)}</div> : <EmptyState title="El primer sorteo está por llegar" description="Los sorteos del periodo aparecerán aquí." />}</section>
      <section className="panel season-panel"><SectionHeader title="Periodo actual" description={`${formatDate(state.config.startDate)} — ${formatDate(state.config.endDate)}`} /><div className="season-progress-label"><span>Aportación utilizada en sorteos</span><strong>{Math.round(spentPercent)} %</strong></div><div className="season-progress" role="meter" aria-label="Porcentaje de aportaciones gastado en sorteos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(spentPercent)}><span style={{ width: `${spentPercent}%` }} /></div><dl className="key-values"><div><dt>Último premio registrado</dt><dd>{lastPrize ? <button className="inline-button" onClick={() => onDraw(lastPrize.id)}>{formatCurrency(drawNetPrize(lastPrize))}<small>{formatDate(lastPrize.date)}</small></button> : "Todavía ninguno"}</dd></div><div><dt>Ajustes de caja</dt><dd>{formatCurrency(summary.adjustmentsToDate)}</dd></div><div><dt>Sorteos planificados</dt><dd>{state.draws.length}</dd></div></dl><div className="help-note"><CircleHelp size={17} /><p>El saldo previsto descuenta todos los sorteos planificados. Los premios futuros no se estiman.</p></div></section></div>
    {latestChecked && <section className="panel verified-result"><div><p className="eyebrow">ÚLTIMA COMBINACIÓN REGISTRADA</p><h2>{formatDate(latestChecked.date)}</h2><p>{latestChecked.resultSummary || latestChecked.notes || "Consulta el detalle del resultado."}</p></div><Combination numbers={latestChecked.winningNumbers!} stars={latestChecked.winningStars!} compact hits={latestChecked.betNumbers ?? state.config.numbers} starHits={latestChecked.betStars ?? state.config.stars} /><TextLink onClick={() => onDraw(latestChecked.id)}>Ver detalle</TextLink></section>}
    {!latest && <p className="muted">Los sorteos se registrarán desde el comienzo del periodo.</p>}
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) { return <div className="metric"><div><span>{label}</span>{icon}</div><strong>{value}</strong><small>{detail}</small></div>; }

function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(60);
  const visible = logs.filter((log) => (filter === "all" || log.level === filter) && `${log.message} ${log.details ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
  return <section className="panel"><SectionHeader title="Registro de actividad" description={`${logs.length} eventos guardados`} /><div className="filter-toolbar"><div className="segmented" aria-label="Filtrar registro">{[["all", "Todo"], ["warning", "Avisos"], ["error", "Errores"]].map(([id, label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="search-field"><span className="sr-only">Buscar en el registro</span><input type="search" placeholder="Buscar un evento…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>{visible.length ? <div className="log-list">{visible.slice(0, limit).map((log) => <article key={log.id} className={`log-entry ${log.level}`}><span className="log-icon">{log.level === "info" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span><div><div className="log-title"><h3>{log.message}</h3><time dateTime={log.at}>{new Date(log.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</time></div>{log.details && <p>{log.details}</p>}<span className="log-level">{log.level === "info" ? "Información" : log.level === "warning" ? "Aviso" : "Error"}</span></div></article>)}</div> : <EmptyState title="Sin eventos para mostrar" description="Los resultados de las comprobaciones y los cambios aparecerán en este registro." />}{visible.length > limit && <div className="list-footer"><span>{limit} de {visible.length} eventos</span><button className="button secondary small" onClick={() => setLimit((current) => current + 60)}>Mostrar más eventos</button></div>}</section>;
}
