import { ArrowDown, CheckCircle2, ChevronRight, ExternalLink, FilePenLine, RefreshCw, Search, ShieldCheck, Ticket } from "lucide-react";
import { useRef, useState } from "react";
import type { AppConfig, AppState, DrawEntry } from "../types";
import { formatDate, isResultDue, isoWeek, todayIso, weekdayShort } from "../lib/dates";
import { categoryLabel, countMatches, drawCost, drawNetPrize, formatCurrency } from "../lib/domain";
import { getPendingDraws } from "../lib/reconciliation";
import { parseNumberList } from "../lib/validation";
import { Combination, Dialog, EmptyState, SectionHeader, StatusBadge, safeSourceUrl } from "./ui";

type Filter = "recent" | "pending" | "prizes" | "all";
function resultText(draw: DrawEntry, config: AppConfig): string {
  if (!draw.winningNumbers || !draw.winningStars) return draw.status === "manual" ? "Registro importado o manual" : "Sin resultado registrado";
  const { numberHits, starHits } = countMatches(draw.betNumbers ?? config.numbers, draw.betStars ?? config.stars, draw.winningNumbers, draw.winningStars);
  return `${numberHits} números + ${starHits} estrellas`;
}

export function DrawsView({ state, filter, onFilter, onSelect, onReviewAll, checksDisabled }: { state: AppState; filter: Filter; onFilter: (filter: Filter) => void; onSelect: (id: string) => void; onReviewAll: () => void; checksDisabled: boolean }) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(30);
  const pendingIds = new Set(getPendingDraws(state).map((draw) => draw.id));
  const groups: Record<Filter, DrawEntry[]> = {
    recent: state.draws.filter((draw) => draw.date <= todayIso()),
    pending: state.draws.filter((draw) => pendingIds.has(draw.id)),
    prizes: state.draws.filter((draw) => draw.grossPrize > 0 || draw.status === "awaiting-prize"),
    all: state.draws,
  };
  const visible = [...groups[filter]].filter((draw) => `${draw.date} ${formatDate(draw.date)} ${draw.notes} ${draw.resultSummary ?? ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).sort((a, b) => b.date.localeCompare(a.date));
  const filters = [["recent", "Hasta hoy"], ["pending", "Pendientes"], ["prizes", "Con premio"], ["all", "Todos"]] as const;
  return <section className="panel draws-panel"><SectionHeader title="Historial de sorteos" description="Del más reciente al más antiguo. Abre un sorteo para consultar o corregir sus datos."><span className="subtle-label"><ArrowDown size={14} />Más recientes primero</span></SectionHeader><div className="filter-toolbar"><p className="form-hint">Revisa también los registros importados, manuales y ya comprobados. Sus importes manuales se conservan; cualquier discrepancia quedará pendiente de revisión.</p><button type="button" className="button secondary small" disabled={checksDisabled} onClick={onReviewAll}><RefreshCw size={16} />Revisar histórico completo</button></div><div className="filter-toolbar"><div className="segmented" aria-label="Filtrar sorteos">{filters.map(([id, label]) => <button key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => { onFilter(id); setLimit(30); }}>{label}<span>{groups[id].length}</span></button>)}</div><label className="search-field"><Search size={17} /><span className="sr-only">Buscar por fecha o nota</span><input type="search" placeholder="Fecha o nota…" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(30); }} /></label></div>
    {visible.length ? <><div className="desktop-draws"><table className="draws-table"><thead><tr><th scope="col">Sorteo</th><th scope="col">Resultado</th><th scope="col">Estado</th><th scope="col" className="align-right">Premio neto</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead><tbody>{visible.slice(0, limit).map((draw) => <tr key={draw.id}><td><button className="date-button" onClick={() => onSelect(draw.id)}><span className="table-ticket"><Ticket size={17} /></span><span><strong>{formatDate(draw.date)}</strong><small>{weekdayShort(draw.date)} · {formatCurrency(drawCost(draw))} de coste</small></span></button></td><td><span className="result-cell">{resultText(draw, state.config)}</span>{draw.checkError && <small className="error-caption">{draw.status === "error" ? "La última consulta falló" : "Importe pendiente de revisión"}</small>}</td><td><StatusBadge draw={draw} /></td><td className={`align-right money ${drawNetPrize(draw) > 0 ? "positive" : ""}`}>{draw.status === "awaiting-prize" && draw.grossPrize === 0 ? <span className="pending-amount">Por confirmar</span> : formatCurrency(drawNetPrize(draw))}</td><td><button className="icon-button" aria-label={`Abrir sorteo del ${formatDate(draw.date)}`} onClick={() => onSelect(draw.id)}><ChevronRight size={19} /></button></td></tr>)}</tbody></table></div><div className="mobile-draws">{visible.slice(0, limit).map((draw) => <button key={draw.id} className="mobile-draw-card" onClick={() => onSelect(draw.id)}><div><span className="mobile-draw-date"><Ticket size={17} /><strong>{formatDate(draw.date)}</strong></span><ChevronRight size={17} /></div><StatusBadge draw={draw} /><div><span>{resultText(draw, state.config)}</span><strong className={drawNetPrize(draw) > 0 ? "positive" : ""}>{draw.status === "awaiting-prize" && draw.grossPrize === 0 ? "Por confirmar" : formatCurrency(drawNetPrize(draw))}</strong></div><small>Coste {formatCurrency(drawCost(draw))} · {weekdayShort(draw.date)}</small></button>)}</div><div className="list-footer"><span>Mostrando {Math.min(visible.length, limit)} de {visible.length} sorteos</span>{visible.length > limit && <button className="button secondary small" onClick={() => setLimit((current) => current + 30)}>Mostrar más</button>}</div></> : <EmptyState title={filter === "pending" ? "Nada pendiente por aquí" : "No hay sorteos en esta vista"} description={filter === "pending" ? "Los sorteos futuros aparecerán cuando llegue el momento de comprobarlos." : "Prueba otro filtro o cambia la búsqueda."} />}
  </section>;
}

export function DrawDetail({ draw, config, onClose, onSave, onCheck, busy }: { draw: DrawEntry; config: AppConfig; onClose: () => void; onSave: (draw: DrawEntry, original: DrawEntry) => void; onCheck: () => void; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const originalRef = useRef(draw);
  const [lines, setLines] = useState(String(draw.lines));
  const [cost, setCost] = useState(String(draw.costPerLine));
  const [gross, setGross] = useState(String(draw.grossPrize));
  const [expenses, setExpenses] = useState(String(draw.expenses));
  const [notes, setNotes] = useState(draw.notes);
  const [numbers, setNumbers] = useState(draw.winningNumbers?.join(" ") ?? "");
  const [stars, setStars] = useState(draw.winningStars?.join(" ") ?? "");
  const [confirmPrize, setConfirmPrize] = useState(false);
  const [error, setError] = useState("");
  const ownNumbers = draw.betNumbers ?? config.numbers;
  const ownStars = draw.betStars ?? config.stars;
  const source = safeSourceUrl(draw.resultSource);
  const protectedPrize = draw.prizeSource === "manual" || draw.prizeSource === "imported" || draw.status === "manual";
  const matches = draw.winningNumbers && draw.winningStars ? countMatches(ownNumbers, ownStars, draw.winningNumbers, draw.winningStars) : undefined;
  function startEditing() {
    originalRef.current = draw;
    setLines(String(draw.lines)); setCost(String(draw.costPerLine)); setGross(String(draw.grossPrize)); setExpenses(String(draw.expenses));
    setNotes(draw.notes); setNumbers(draw.winningNumbers?.join(" ") ?? ""); setStars(draw.winningStars?.join(" ") ?? ""); setConfirmPrize(false); setError(""); setEditing(true);
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const amounts = [lines, cost, gross, expenses];
    if (amounts.some((value) => value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) || !Number.isInteger(Number(lines)) || Number(lines) < 1) { setError("Revisa los importes: deben ser números positivos o cero. Las líneas deben ser un entero de al menos 1."); return; }
    const hasResult = numbers.trim() !== "" || stars.trim() !== "";
    const parsedNumbers = hasResult ? parseNumberList(numbers, 1, 50, 5) : undefined;
    const parsedStars = hasResult ? parseNumberList(stars, 1, 12, 2) : undefined;
    if (hasResult && (!parsedNumbers || !parsedStars)) { setError("Introduce 5 números enteros distintos entre 1 y 50 y 2 estrellas distintas entre 1 y 12."); return; }
    const changedResult = hasResult && (JSON.stringify(parsedNumbers) !== JSON.stringify(draw.winningNumbers) || JSON.stringify(parsedStars) !== JSON.stringify(draw.winningStars));
    const changedPrize = Number(gross) !== draw.grossPrize || confirmPrize;
    if (Number(gross) !== draw.grossPrize && !confirmPrize) { setError("Confirma que has revisado el importe del premio antes de guardarlo."); return; }
    const result = parsedNumbers && parsedStars ? countMatches(ownNumbers, ownStars, parsedNumbers, parsedStars) : undefined;
    const next: DrawEntry = { ...draw, lines: Number(lines), costPerLine: Number(cost), grossPrize: Number(gross), expenses: Number(expenses), notes: notes.trim(), ...(changedPrize ? { prizeSource: "manual" as const, status: "manual" as const, checkError: undefined } : {}), ...(changedResult && result ? { winningNumbers: parsedNumbers!, winningStars: parsedStars!, checkedAt: new Date().toISOString(), status: "manual" as const, resultSource: undefined, resultSummary: `${categoryLabel(result.numberHits, result.starHits)}. ${result.numberHits} números y ${result.starHits} estrellas. Resultado introducido manualmente.`, prizeSource: "manual" as const, checkError: undefined } : {}) };
    if (changedResult && result && categoryLabel(result.numberHits, result.starHits) !== "Sin premio" && !confirmPrize && !protectedPrize) { next.status = "awaiting-prize"; next.prizeSource = draw.prizeSource; next.checkError = "Resultado introducido manualmente. Falta confirmar el importe del premio."; }
    try { onSave(next, originalRef.current); } catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa los datos antes de guardar."); }
  }
  return <Dialog title={`Sorteo del ${formatDate(draw.date)}`} description={`${weekdayShort(draw.date)} · Semana ${isoWeek(draw.date)} · Apuesta automática`} onClose={onClose} wide>
    <div className="dialog-body"><div className="detail-status"><StatusBadge draw={draw} />{protectedPrize && <span className="protected-note"><ShieldCheck size={15} />Importe manual protegido</span>}</div>
      {draw.checkError && <div className="notice danger" role="alert"><p>{draw.checkError}</p></div>}
      {draw.status === "awaiting-prize" && <div className="notice warning"><p>{draw.grossPrize > 0 ? `El importe necesita revisión. Se conservan los ${formatCurrency(draw.grossPrize)} brutos registrados hasta que confirmes el valor correcto; el saldo sigue incluyendo ${formatCurrency(drawNetPrize(draw))} netos.` : "Hay un premio detectado, pero su importe todavía no está confirmado. No se añadirá una cantidad estimada al saldo."}</p></div>}
      <div className="detail-combinations"><div><p className="field-caption">Apuesta de este sorteo</p><Combination numbers={ownNumbers} stars={ownStars} compact /></div><div><p className="field-caption">Combinación ganadora</p>{draw.winningNumbers && draw.winningStars ? <Combination numbers={draw.winningNumbers} stars={draw.winningStars} compact hits={ownNumbers} starHits={ownStars} /> : <p className="muted">Todavía sin resultado registrado.</p>}</div></div>
      {matches && <div className="result-summary"><CheckCircle2 size={18} /><strong>{categoryLabel(matches.numberHits, matches.starHits)}</strong><span>{matches.numberHits} números + {matches.starHits} estrellas</span></div>}
      <div className="detail-money"><div><span>Coste del sorteo</span><strong>{formatCurrency(drawCost(draw))}</strong><small>{draw.lines} {draw.lines === 1 ? "línea" : "líneas"} × {formatCurrency(draw.costPerLine)}</small></div><div><span>Premio bruto</span><strong>{draw.status === "awaiting-prize" && draw.grossPrize === 0 ? "Pendiente" : formatCurrency(draw.grossPrize)}</strong><small>Gastos: {formatCurrency(draw.expenses)}</small></div><div><span>Premio neto</span><strong className="positive">{draw.status === "awaiting-prize" && draw.grossPrize === 0 ? "Por confirmar" : formatCurrency(drawNetPrize(draw))}</strong><small>Registrado en caja</small></div></div>
      {draw.resultSummary && <p className="result-note">{draw.resultSummary}</p>}
      {draw.notes && !editing && <div className="draw-note"><strong>Notas del sorteo</strong><p>{draw.notes}</p></div>}
      <div className="source-row"><span>{draw.checkedAt ? `Comprobado: ${new Date(draw.checkedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}` : "Sin comprobación registrada"}</span>{source ? <a href={source} target="_blank" rel="noopener noreferrer">Consultar fuente<ExternalLink size={13} /></a> : draw.resultSource && <span>{draw.resultSource}</span>}</div>
      {!editing && <div className="dialog-actions"><button className="button secondary" onClick={startEditing} disabled={busy}><FilePenLine size={16} />Editar datos</button><button className="button primary" onClick={onCheck} disabled={busy || !isResultDue(draw.date)}><RefreshCw size={16} />{busy ? "Comprobando…" : "Comprobar este sorteo"}</button></div>}
      {editing && <form className="edit-form" onSubmit={save}><SectionHeader title="Revisar datos" description="Los cambios se aplican solo a este sorteo. Los importes manuales se conservan en futuras comprobaciones." />{error && <div className="notice danger" role="alert"><p>{error}</p></div>}<div className="form-grid four"><label>Líneas<input type="number" min="1" step="1" required value={lines} onChange={(event) => setLines(event.target.value)} /></label><label>Coste por línea (€)<input type="number" min="0" step="0.01" required value={cost} onChange={(event) => setCost(event.target.value)} /></label><label>Premio bruto (€)<input type="number" min="0" step="0.01" required value={gross} onChange={(event) => setGross(event.target.value)} /></label><label>Gastos (€)<input type="number" min="0" step="0.01" required value={expenses} onChange={(event) => setExpenses(event.target.value)} /></label></div><label className="checkbox-row"><input type="checkbox" checked={confirmPrize} onChange={(event) => setConfirmPrize(event.target.checked)} /><span>He verificado el importe del premio y quiero guardarlo como manual.</span></label><details className="manual-result"><summary>Introducir o corregir la combinación ganadora</summary><p className="muted">Úsalo cuando hayas comprobado el resultado por tu cuenta.</p><div className="form-grid"><label>5 números ganadores<input value={numbers} onChange={(event) => setNumbers(event.target.value)} placeholder="07 14 17 25 33" /></label><label>2 estrellas<input value={stars} onChange={(event) => setStars(event.target.value)} placeholder="04 07" /></label></div></details><label>Notas<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Añade una nota para este sorteo" /></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancelar</button><button type="submit" className="button primary" disabled={busy}>Guardar cambios</button></div></form>}
    </div>
  </Dialog>;
}
