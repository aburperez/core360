/** Mapa de montagem (fase 5A): status das chegadas. Sem nada do servidor. */

export const ARRIVAL_STATUSES = ["AGENDADO", "CHEGOU", "MONTANDO", "MONTADO", "RETIRADO"] as const;
export type ArrivalStatus = (typeof ARRIVAL_STATUSES)[number];

export const ARRIVAL_STATUS: Record<ArrivalStatus, { label: string; tone: string }> = {
  AGENDADO: { label: "Agendado", tone: "bg-white/10 text-muted" },
  CHEGOU: { label: "Chegou", tone: "bg-sky-500/15 text-sky-300" },
  MONTANDO: { label: "Montando", tone: "bg-amber-400/15 text-amber-200" },
  MONTADO: { label: "Montado", tone: "bg-emerald-500/15 text-emerald-300" },
  RETIRADO: { label: "Retirado", tone: "bg-white/10 text-muted" },
};

/** O botão do próximo passo, no campo. */
export const NEXT_STEP: Partial<Record<ArrivalStatus, { to: ArrivalStatus; label: string }>> = {
  AGENDADO: { to: "CHEGOU", label: "Chegou" },
  CHEGOU: { to: "MONTANDO", label: "Começou a montar" },
  MONTANDO: { to: "MONTADO", label: "Montado" },
  MONTADO: { to: "RETIRADO", label: "Retirado" },
};

export const previousStatus = (s: ArrivalStatus): ArrivalStatus | null => {
  const i = ARRIVAL_STATUSES.indexOf(s);
  return i > 0 ? ARRIVAL_STATUSES[i - 1]! : null;
};

/**
 * Atrasada: passou da hora e não chegou, ou passou do fim previsto e ainda não
 * está montada.
 */
export function arrivalLate(a: { status: ArrivalStatus; scheduledAt: Date | string | null; endsAt: Date | string | null }, now = new Date()) {
  const t = (d: Date | string | null) => (d ? new Date(d).getTime() : null);
  if (a.status === "AGENDADO" && t(a.scheduledAt) !== null && t(a.scheduledAt)! < now.getTime()) return "Não chegou no horário";
  if ((a.status === "CHEGOU" || a.status === "MONTANDO") && t(a.endsAt) !== null && t(a.endsAt)! < now.getTime()) return "Montagem atrasada";
  return null;
}
