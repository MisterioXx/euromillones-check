import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Download,
  History,
  Landmark,
  ListChecks,
  Loader2,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CashMovement, DrawEntry, LogEntry, OfficialCheckResponse } from "./types";
import { formatDate, isoWeek, todayIso, weekdayShort } from "./lib/dates";
import {
  categoryLabel,
  countMatches,
  drawCost,
  drawNetPrize,
  formatCurrency,
  getLatestPlayableDraw,
  totals,
} from "./lib/domain";
import { checkOfficialResults } from "./lib/official";
import { initialState } from "./lib/seed";
import { buildLog, exportState, loadState, saveState } from "./lib/storage";

type Tab = "dashboard" | "draws" | "cash" | "settings" | "logs";

const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "dashboard", label: "Panel", icon: Activity },
  { id: "draws", label: "Sorteos", icon: Ticket },
  { id: "cash", label: "Caja", icon: Landmark },
  { id: "settings", label: "Config", icon: Settings },
  { id: "logs", label: "Logs", icon: History },
];

function numberList(value: number[]): string {
  return value.map((number) => String(number).padStart(2, "0")).join(" ");
}

function parseNumberList(value: string, min: number, max: number, expected: number): number[] | null {
  const parsed = value
    .split(/[,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  const unique = [...new Set(parsed)];
  if (unique.length !== expected || unique.some((item) => item < min || item > max)) return null;
  return unique.sort((a, b) => a - b);
}

function sortDraws(draws: DrawEntry[]): DrawEntry[] {
  return [...draws].sort((a, b) => a.date.localeCompare(b.date));
}

function statusLabel(status: DrawEntry["status"]): string {
  if (status === "checked") return "Comprobado";
  if (status === "manual") return "Revisado";
  return "Pendiente";
}

function isResultDue(date: string): boolean {
  const today = todayIso();
  if (date < today) return true;
  if (date > today) return false;
  return new Date().getHours() >= 22;
}

function getLatestResultDueDraw(draws: DrawEntry[]): DrawEntry | undefined {
  return [...draws]
    .filter((draw) => draw.played && isResultDue(draw.date))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function prizeAmountForCategory(
  category: string,
  prizes: OfficialCheckResponse["prizes"],
): number | undefined {
  if (!prizes?.length || category === "Sin premio") return category === "Sin premio" ? 0 : undefined;
  const target = category.match(/\d+/)?.[0];
  if (!target) return undefined;
  return prizes.find((prize) => prize.category.match(/\d+/)?.[0] === target)?.amount;
}

export function App() {
  const [state, setState] = useState(loadState);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [isChecking, setIsChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const autoCheckDone = useRef(false);
  const summary = useMemo(() => totals(state), [state]);
  const latestDraw = useMemo(() => getLatestPlayableDraw(state), [state]);
  const latestResultDueDraw = useMemo(() => getLatestResultDueDraw(state.draws), [state.draws]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!state.config.autoCheckOnOpen || autoCheckDone.current || !latestDraw) return;
    autoCheckDone.current = true;
    void runPendingOfficialChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config.autoCheckOnOpen, latestDraw?.id]);

  function patchState(updater: (current: typeof state) => typeof state) {
    setState((current) => updater(current));
  }

  function addLog(level: LogEntry["level"], message: string, details?: string) {
    patchState((current) => ({
      ...current,
      logs: [buildLog(level, message, details), ...current.logs].slice(0, 250),
    }));
  }

  function updateDraw(drawId: string, patch: Partial<DrawEntry>) {
    patchState((current) => ({
      ...current,
      draws: current.draws.map((draw) => (draw.id === drawId ? { ...draw, ...patch } : draw)),
    }));
  }

  function applyResult(
    drawId: string,
    winningNumbers: number[],
    winningStars: number[],
    prizeAmount?: number,
  ) {
    const { numberHits, starHits } = countMatches(
      state.config.numbers,
      state.config.stars,
      winningNumbers,
      winningStars,
    );
    const category = categoryLabel(numberHits, starHits);
    const draw = state.draws.find((entry) => entry.id === drawId);
    const grossPrize = prizeAmount ?? (category === "Sin premio" ? 0 : draw?.grossPrize ?? 0);

    updateDraw(drawId, {
      status: "checked",
      checkedAt: new Date().toISOString(),
      winningNumbers,
      winningStars,
      grossPrize,
      notes: `${category}. Aciertos: ${numberHits} numeros y ${starHits} estrellas.`,
    });

    addLog(
      category === "Sin premio" ? "info" : "warning",
      `Comprobado sorteo ${draw ? formatDate(draw.date) : drawId}: ${category}.`,
      `Ganadora: ${numberList(winningNumbers)} + ${numberList(winningStars)}. Jugada: ${numberList(
        state.config.numbers,
      )} + ${numberList(state.config.stars)}.`,
    );
    setNotice(`Resultado aplicado: ${category}.`);
  }

  function applyOfficialResult(drawId: string, result: Awaited<ReturnType<typeof checkOfficialResults>>) {
    if (!result.numbers || !result.stars) return;
    const { numberHits, starHits } = countMatches(
      state.config.numbers,
      state.config.stars,
      result.numbers,
      result.stars,
    );
    const category = categoryLabel(numberHits, starHits);
    const prizeAmount = result.prizeAmount ?? prizeAmountForCategory(category, result.prizes);
    if (category !== "Sin premio" && prizeAmount === undefined) {
      updateDraw(drawId, {
        status: "checked",
        checkedAt: new Date().toISOString(),
        winningNumbers: result.numbers,
        winningStars: result.stars,
        notes: `${category}. Aciertos: ${numberHits} numeros y ${starHits} estrellas. Importe pendiente: la fuente no incluyo tabla de premios.`,
      });
      addLog(
        "warning",
        "Premio detectado sin importe automatico.",
        `Sorteo ${result.date ?? result.requestedDate ?? drawId}: ${category}.`,
      );
      return;
    }

    applyResult(drawId, result.numbers, result.stars, prizeAmount);
  }

  async function runPendingOfficialChecks() {
    const pendingDraws = sortDraws(state.draws).filter(
      (draw) => draw.played && draw.status === "pending" && isResultDue(draw.date),
    );

    if (pendingDraws.length === 0) return;

    setIsChecking(true);
    setNotice(null);

    let checked = 0;
    try {
      for (const draw of pendingDraws) {
        const result = await checkOfficialResults(draw.date);
        if (!result.ok || !result.numbers || !result.stars) {
          addLog(
            "warning",
            "Comprobacion automatica detenida.",
            `${formatDate(draw.date)}: ${result.message ?? "No hay resultado disponible."}`,
          );
          setNotice(result.message ?? "No hay resultado oficial disponible todavia.");
          break;
        }

        applyOfficialResult(draw.id, result);
        checked += 1;
      }

      if (checked > 0) {
        addLog("info", "Comprobacion automatica completada.", `${checked} sorteo(s) actualizado(s).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      addLog("error", "Fallo en comprobacion automatica.", message);
      setNotice(message);
    } finally {
      setIsChecking(false);
    }
  }

  async function runOfficialCheck(mode: "manual" | "auto" = "manual") {
    setIsChecking(true);
    setNotice(null);
    try {
      const targetDate = mode === "manual" ? latestResultDueDraw?.date : undefined;
      if (mode === "manual" && !targetDate) {
        setNotice("Todavia no hay ningun sorteo con resultado disponible para comprobar.");
        return;
      }
      const result = await checkOfficialResults(targetDate);
      if (!result.ok || !result.numbers || !result.stars) {
        addLog(
          "warning",
          mode === "auto" ? "Comprobacion automatica sin resultado." : "No se pudo comprobar automaticamente.",
          result.message ?? result.rawSnippet,
        );
        setNotice(result.message ?? "No se pudo extraer el resultado oficial.");
        return;
      }

      const target =
        state.draws.find((draw) => draw.date === result.date) ??
        getLatestPlayableDraw(state, result.date ?? todayIso());
      if (!target) {
        addLog("error", "Resultado oficial obtenido sin sorteo local equivalente.", result.date);
        return;
      }
      applyOfficialResult(target.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      addLog("error", "Fallo consultando el comprobador oficial.", message);
      setNotice(message);
    } finally {
      setIsChecking(false);
    }
  }

  function addMovement(movement: Omit<CashMovement, "id">) {
    patchState((current) => ({
      ...current,
      movements: [{ id: crypto.randomUUID(), ...movement }, ...current.movements],
      logs: [
        buildLog(
          "info",
          `Movimiento registrado: ${movement.description}`,
          `${formatCurrency(movement.amount)} el ${movement.date}`,
        ),
        ...current.logs,
      ].slice(0, 250),
    }));
  }

  function resetDemoData() {
    if (!window.confirm("Restaurar los datos iniciales importados del Excel?")) return;
    setState(initialState);
    setNotice("Datos restaurados.");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>EuroControl</strong>
            <span>Peña Euromillones</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Secciones">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "nav-item active" : "nav-item"}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <span className="muted">Combinacion</span>
          <div className="balls compact">
            {state.config.numbers.map((number) => (
              <span key={number} className="ball">
                {String(number).padStart(2, "0")}
              </span>
            ))}
            {state.config.stars.map((star) => (
              <span key={star} className="star">
                {star}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Control compartido</p>
            <h1>Gestion de Euromillones</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={() => exportState(state)}>
              <Download size={17} />
              Exportar
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void runOfficialCheck("manual")}
              disabled={isChecking}
            >
              {isChecking ? <Loader2 className="spin" size={17} /> : <ListChecks size={17} />}
              Comprobar
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice">
            <AlertTriangle size={18} />
            <span>{notice}</span>
          </div>
        )}

        {activeTab === "dashboard" && (
          <Dashboard
            state={state}
            summary={summary}
            latestDraw={latestDraw}
            latestResultDueDraw={latestResultDueDraw}
            onApplyResult={applyResult}
            onCheck={() => void runOfficialCheck("manual")}
            isChecking={isChecking}
          />
        )}
        {activeTab === "draws" && <DrawsView draws={state.draws} onUpdate={updateDraw} />}
        {activeTab === "cash" && (
          <CashView state={state} summary={summary} onAddMovement={addMovement} />
        )}
        {activeTab === "settings" && (
          <SettingsView
            state={state}
            onUpdate={(nextState) => setState(nextState)}
            onReset={resetDemoData}
            onLog={addLog}
          />
        )}
        {activeTab === "logs" && <LogsView logs={state.logs} />}
      </main>
    </div>
  );
}

function Dashboard({
  state,
  summary,
  latestDraw,
  latestResultDueDraw,
  onApplyResult,
  onCheck,
  isChecking,
}: {
  state: ReturnType<typeof loadState>;
  summary: ReturnType<typeof totals>;
  latestDraw?: DrawEntry;
  latestResultDueDraw?: DrawEntry;
  onApplyResult: (drawId: string, numbers: number[], stars: number[], prizeAmount?: number) => void;
  onCheck: () => void;
  isChecking: boolean;
}) {
  const [manualNumbers, setManualNumbers] = useState("");
  const [manualStars, setManualStars] = useState("");
  const [manualPrize, setManualPrize] = useState("");
  const nextDraw = state.draws.find((draw) => draw.date >= todayIso());
  const lastPrize = [...state.draws]
    .filter((draw) => drawNetPrize(draw) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  function submitManual(event: React.FormEvent) {
    event.preventDefault();
    if (!latestDraw) return;
    const numbers = parseNumberList(manualNumbers, 1, 50, 5);
    const stars = parseNumberList(manualStars, 1, 12, 2);
    if (!numbers || !stars) {
      window.alert("Introduce 5 numeros entre 1 y 50 y 2 estrellas entre 1 y 12.");
      return;
    }
    const prize = manualPrize.trim() === "" ? undefined : Number(manualPrize);
    onApplyResult(latestDraw.id, numbers, stars, Number.isFinite(prize) ? prize : undefined);
    setManualNumbers("");
    setManualStars("");
    setManualPrize("");
  }

  return (
    <section className="content-grid">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">Saldo actual</p>
          <div className="hero-value">{formatCurrency(summary.balanceToDate)}</div>
          <p className="muted">
            Gastado hasta hoy: {formatCurrency(summary.spentToDate)} de{" "}
            {formatCurrency(summary.contributionTotal)} aportados.
          </p>
        </div>
        <div className="combination-card">
          <span>Jugada fija</span>
          <div className="balls">
            {state.config.numbers.map((number) => (
              <strong key={number} className="ball">
                {String(number).padStart(2, "0")}
              </strong>
            ))}
            {state.config.stars.map((star) => (
              <strong key={star} className="star">
                {star}
              </strong>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi icon={Coins} label="Aportado" value={formatCurrency(summary.contributionTotal)} />
        <Kpi icon={Ticket} label="Sorteos jugados" value={`${summary.drawsPlayedToDate}`} />
        <Kpi icon={CircleDollarSign} label="Premios netos" value={formatCurrency(summary.prizesToDate)} />
        <Kpi icon={CalendarDays} label="Proyectado" value={formatCurrency(summary.projectedBalance)} />
      </div>

      <div className="two-column">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Ultimo sorteo</h2>
              <p>
                {latestDraw
                  ? `${formatDate(latestDraw.date)} · ${weekdayShort(latestDraw.date)}`
                  : "Sin sorteos"}
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={onCheck} disabled={isChecking}>
              {isChecking ? <Loader2 className="spin" size={16} /> : <ListChecks size={16} />}
              Oficial
            </button>
          </div>
          {latestResultDueDraw && latestDraw?.date !== latestResultDueDraw.date && (
            <p className="inline-hint">
              Se comprobara el ultimo resultado publicado: {formatDate(latestResultDueDraw.date)}.
            </p>
          )}
          {latestDraw && (
            <div className="draw-status">
              <span className={`status-pill ${latestDraw.status}`}>
                {statusLabel(latestDraw.status)}
              </span>
              <strong>{formatCurrency(drawCost(latestDraw))}</strong>
              <span>{latestDraw.notes || "Pendiente de comprobar."}</span>
            </div>
          )}

          <form className="manual-check" onSubmit={submitManual}>
            <label>
              Numeros ganadores
              <input
                value={manualNumbers}
                onChange={(event) => setManualNumbers(event.target.value)}
                placeholder="07 14 17 25 33"
              />
            </label>
            <label>
              Estrellas
              <input
                value={manualStars}
                onChange={(event) => setManualStars(event.target.value)}
                placeholder="4 7"
              />
            </label>
            <label>
              Premio bruto
              <input
                type="number"
                step="0.01"
                value={manualPrize}
                onChange={(event) => setManualPrize(event.target.value)}
                placeholder="0,00"
              />
            </label>
            <button className="primary-button" type="submit" disabled={!latestDraw}>
              <CheckCircle2 size={17} />
              Aplicar
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Actividad</h2>
              <p>Resumen rapido del ciclo actual</p>
            </div>
          </div>
          <div className="activity-list">
            <ActivityRow label="Proximo sorteo" value={nextDraw ? formatDate(nextDraw.date) : "Sin programar"} />
            <ActivityRow label="Ultimo premio" value={lastPrize ? `${formatDate(lastPrize.date)} · ${formatCurrency(drawNetPrize(lastPrize))}` : "Ninguno"} />
            <ActivityRow label="Ajustes caja" value={formatCurrency(summary.adjustmentsToDate)} />
            <ActivityRow label="Gasto anual previsto" value={formatCurrency(summary.plannedSpend)} />
          </div>
        </section>
      </div>
    </section>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon">
        <Icon size={19} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActivityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="activity-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DrawsView({
  draws,
  onUpdate,
}: {
  draws: DrawEntry[];
  onUpdate: (drawId: string, patch: Partial<DrawEntry>) => void;
}) {
  const [filter, setFilter] = useState<"to-date" | "all" | "pending" | "prizes">("to-date");
  const visibleDraws = sortDraws(draws).filter((draw) => {
    if (filter === "to-date") return draw.date <= todayIso();
    if (filter === "pending") return draw.status === "pending" && draw.date <= todayIso();
    if (filter === "prizes") return drawNetPrize(draw) > 0;
    return true;
  });

  return (
    <section className="panel wide-panel">
      <div className="panel-header">
        <div>
          <h2>Sorteos</h2>
          <p>Coste, premio y estado de cada martes y viernes.</p>
        </div>
        <div className="segmented">
          {[
            ["to-date", "Hasta hoy"],
            ["pending", "Pendientes"],
            ["prizes", "Premios"],
            ["all", "Todo"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id as typeof filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table draws-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Semana</th>
              <th>Apuesta</th>
              <th>Lineas</th>
              <th>Coste</th>
              <th>Premio</th>
              <th>Gastos</th>
              <th>Estado</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {visibleDraws.map((draw) => (
              <tr key={draw.id}>
                <td>
                  <strong>{formatDate(draw.date)}</strong>
                  <span className="subtext">{weekdayShort(draw.date)}</span>
                </td>
                <td>{isoWeek(draw.date)}</td>
                <td>
                  <span className="auto-pill">Automatica</span>
                </td>
                <td>
                  <input
                    className="mini-input"
                    type="number"
                    min="0"
                    step="1"
                    value={draw.lines}
                    onChange={(event) => onUpdate(draw.id, { lines: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className="mini-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draw.costPerLine}
                    onChange={(event) => onUpdate(draw.id, { costPerLine: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className="mini-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draw.grossPrize}
                    onChange={(event) =>
                      onUpdate(draw.id, { grossPrize: Number(event.target.value), status: "manual" })
                    }
                  />
                </td>
                <td>
                  <input
                    className="mini-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draw.expenses}
                    onChange={(event) => onUpdate(draw.id, { expenses: Number(event.target.value) })}
                  />
                </td>
                <td>
                  <span className={`status-pill ${draw.status}`}>{statusLabel(draw.status)}</span>
                </td>
                <td>
                  <input
                    className="note-input"
                    value={draw.notes}
                    onChange={(event) => onUpdate(draw.id, { notes: event.target.value })}
                    placeholder="Nota"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CashView({
  state,
  summary,
  onAddMovement,
}: {
  state: ReturnType<typeof loadState>;
  summary: ReturnType<typeof totals>;
  onAddMovement: (movement: Omit<CashMovement, "id">) => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!description.trim() || !Number.isFinite(parsedAmount)) return;
    onAddMovement({
      date,
      amount: parsedAmount,
      description: description.trim(),
      kind: "adjustment",
    });
    setDescription("");
    setAmount("");
  }

  return (
    <section className="two-column align-start">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Caja</h2>
            <p>Aportaciones, gasto automatico y ajustes manuales.</p>
          </div>
        </div>
        <div className="activity-list">
          <ActivityRow label="Aportado por el grupo" value={formatCurrency(summary.contributionTotal)} />
          <ActivityRow label="Gastado hasta hoy" value={formatCurrency(summary.spentToDate)} />
          <ActivityRow label="Premios netos" value={formatCurrency(summary.prizesToDate)} />
          <ActivityRow label="Saldo actual" value={formatCurrency(summary.balanceToDate)} />
        </div>

        <div className="participants">
          {state.participants.map((participant) => {
            const total = participant.annualContribution + participant.extraContribution;
            return (
              <div key={participant.id} className="participant">
                <Users size={17} />
                <span>{participant.name}</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Movimiento manual</h2>
            <p>Usa importes negativos para gastos externos.</p>
          </div>
        </div>
        <form className="stacked-form" onSubmit={submit}>
          <label>
            Fecha
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Descripcion
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Boleto Navidad"
            />
          </label>
          <label>
            Importe
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="-60"
            />
          </label>
          <button className="primary-button" type="submit">
            <Save size={17} />
            Guardar movimiento
          </button>
        </form>

        <div className="movement-list">
          {state.movements.length === 0 && <p className="muted">Sin movimientos manuales.</p>}
          {state.movements.map((movement) => (
            <div key={movement.id} className="movement-row">
              <div>
                <strong>{movement.description}</strong>
                <span>{formatDate(movement.date)}</span>
              </div>
              <strong className={movement.amount < 0 ? "negative" : "positive"}>
                {formatCurrency(movement.amount)}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsView({
  state,
  onUpdate,
  onReset,
  onLog,
}: {
  state: ReturnType<typeof loadState>;
  onUpdate: (state: ReturnType<typeof loadState>) => void;
  onReset: () => void;
  onLog: (level: LogEntry["level"], message: string, details?: string) => void;
}) {
  const [numbers, setNumbers] = useState(numberList(state.config.numbers));
  const [stars, setStars] = useState(numberList(state.config.stars));

  function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    const parsedNumbers = parseNumberList(numbers, 1, 50, 5);
    const parsedStars = parseNumberList(stars, 1, 12, 2);
    if (!parsedNumbers || !parsedStars) {
      window.alert("La combinacion no es valida.");
      return;
    }
    onUpdate({
      ...state,
      config: {
        ...state.config,
        numbers: parsedNumbers,
        stars: parsedStars,
      },
    });
    onLog("info", "Configuracion actualizada.", `Jugada: ${numberList(parsedNumbers)} + ${numberList(parsedStars)}`);
  }

  return (
    <section className="two-column align-start">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Configuracion</h2>
            <p>Datos principales de la pena.</p>
          </div>
        </div>
        <form className="stacked-form" onSubmit={saveConfig}>
          <label>
            Numeros
            <input value={numbers} onChange={(event) => setNumbers(event.target.value)} />
          </label>
          <label>
            Estrellas
            <input value={stars} onChange={(event) => setStars(event.target.value)} />
          </label>
          <label className="toggle-row">
            <span>Comprobar al abrir</span>
            <input
              type="checkbox"
              checked={state.config.autoCheckOnOpen}
              onChange={(event) =>
                onUpdate({
                  ...state,
                  config: { ...state.config, autoCheckOnOpen: event.target.checked },
                })
              }
            />
          </label>
          <button className="primary-button" type="submit">
            <SlidersHorizontal size={17} />
            Guardar configuracion
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Participantes</h2>
            <p>Aportaciones del Excel original.</p>
          </div>
        </div>
        <div className="settings-list">
          {state.participants.map((participant) => (
            <div key={participant.id} className="settings-row">
              <input
                value={participant.name}
                onChange={(event) =>
                  onUpdate({
                    ...state,
                    participants: state.participants.map((item) =>
                      item.id === participant.id ? { ...item, name: event.target.value } : item,
                    ),
                  })
                }
              />
              <input
                type="number"
                step="0.01"
                value={participant.annualContribution}
                onChange={(event) =>
                  onUpdate({
                    ...state,
                    participants: state.participants.map((item) =>
                      item.id === participant.id
                        ? { ...item, annualContribution: Number(event.target.value) }
                        : item,
                    ),
                  })
                }
              />
            </div>
          ))}
        </div>
        <button className="danger-button" type="button" onClick={onReset}>
          <RotateCcw size={17} />
          Restaurar datos iniciales
        </button>
      </div>
    </section>
  );
}

function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <section className="panel wide-panel">
      <div className="panel-header">
        <div>
          <h2>Logs</h2>
          <p>Errores de comprobacion, cambios importantes y avisos.</p>
        </div>
      </div>
      <div className="log-list">
        {logs.map((log) => (
          <article key={log.id} className={`log-entry ${log.level}`}>
            <div>
              <strong>{log.message}</strong>
              <span>{new Date(log.at).toLocaleString("es-ES")}</span>
            </div>
            {log.details && <p>{log.details}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
