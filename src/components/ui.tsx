import { Check, ChevronRight, Clock3, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DrawEntry } from "../types";
import { isResultDue, todayIso } from "../lib/dates";

export function drawStatus(draw: DrawEntry): { label: string; tone: string } {
  if (draw.status === "awaiting-prize") return { label: "Importe pendiente", tone: "warning" };
  if (draw.status === "error") return { label: "Revisar", tone: "danger" };
  if (draw.status === "manual") return { label: draw.prizeSource === "imported" ? "Importado" : "Revisado manualmente", tone: "neutral" };
  if (draw.status === "checked") return { label: "Comprobado", tone: "success" };
  if (draw.date > todayIso()) return { label: "Programado", tone: "neutral" };
  if (!isResultDue(draw.date)) return { label: "Esperando resultado", tone: "neutral" };
  return { label: "Pendiente", tone: "warning" };
}

export function StatusBadge({ draw }: { draw: DrawEntry }) {
  const status = drawStatus(draw);
  return <span className={`badge ${status.tone}`}><span className="status-dot" />{status.label}</span>;
}

export function Combination({ numbers, stars, compact = false, hits, starHits }: {
  numbers: number[]; stars: number[]; compact?: boolean; hits?: number[]; starHits?: number[];
}) {
  return <div className={`combination ${compact ? "compact" : ""}`} aria-label={`Números ${numbers.join(", ")}. Estrellas ${stars.join(", ")}.`}>
    <div className="number-balls" aria-hidden="true">{numbers.map((number) => <span key={number} className={`ball ${hits?.includes(number) ? "hit" : ""}`}>{String(number).padStart(2, "0")}</span>)}</div>
    <span className="combination-divider" aria-hidden="true" />
    <div className="number-balls" aria-hidden="true">{stars.map((number) => <span key={number} className={`ball star-ball ${starHits?.includes(number) ? "hit" : ""}`}>{String(number).padStart(2, "0")}</span>)}</div>
  </div>;
}

export function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Check size={24} /></div><h3>{title}</h3><p>{description}</p>{children}</div>;
}

export function Dialog({ title, description, onClose, children, wide = false }: {
  title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className={`dialog ${wide ? "wide-dialog" : ""}`} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-header"><div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button" aria-label="Cerrar ventana" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

export function SectionHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</div>;
}

export function CheckButton({ busy, onClick, children = "Comprobar" }: { busy: boolean; onClick: () => void; children?: ReactNode }) {
  return <button type="button" className="button secondary small" disabled={busy} onClick={onClick}>{busy ? <LoaderCircle size={16} className="spin" /> : <Clock3 size={16} />}{children}</button>;
}

export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="text-link" onClick={onClick}>{children}<ChevronRight size={15} /></button>;
}

export function safeSourceUrl(source?: string): string | undefined {
  if (!source) return undefined;
  try { const url = new URL(source); return ["https:", "http:"].includes(url.protocol) ? url.toString() : undefined; } catch { return undefined; }
}
