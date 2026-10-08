/** Central de pendências (fase 4B): grupos e rótulos. Sem nada do servidor. */

export type PendencyKind = "MARCO" | "ITEM" | "COTACAO" | "CONTRATO" | "AVALIACAO" | "MANUAL";
export type PendencyGroup = "ATRASADO" | "HOJE" | "SEMANA" | "SEM_DATA";

export const KIND_LABEL: Record<PendencyKind, string> = {
  MARCO: "Marco",
  ITEM: "Item",
  COTACAO: "Cotação",
  CONTRATO: "Contrato",
  AVALIACAO: "Avaliação",
  MANUAL: "Pendência",
};

export const GROUPS: { key: PendencyGroup; title: string; empty: string }[] = [
  { key: "ATRASADO", title: "Atrasado", empty: "Nada atrasado." },
  { key: "HOJE", title: "Vence hoje", empty: "Nada vence hoje." },
  { key: "SEMANA", title: "Próximos 7 dias", empty: "Nada nos próximos 7 dias." },
  { key: "SEM_DATA", title: "Sem data", empty: "" },
];

/** Atrasado (crítica), hoje, nos próximos 7 dias, depois ou sem data. */
export function pendencyGroup(due: string | null, today: string, weekEnd: string, lateNow = false): PendencyGroup | "DEPOIS" {
  if (lateNow) return "ATRASADO";
  if (!due) return "SEM_DATA";
  if (due < today) return "ATRASADO";
  if (due === today) return "HOJE";
  return due <= weekEnd ? "SEMANA" : "DEPOIS";
}
