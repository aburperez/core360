export const CONTRACT = {
  RASCUNHO: { label: "Rascunho", tone: "bg-white/10 text-muted" },
  ENVIADO: { label: "Enviado", tone: "bg-sky-400/15 text-sky-200" },
  ASSINADO: { label: "Assinado", tone: "bg-emerald-500/15 text-emerald-300" },
  CANCELADO: { label: "Cancelado", tone: "bg-red-500/15 text-red-300" },
} as const;

/** Data do contrato (coluna date): mostrada como foi gravada, sem fuso. */
export const formatDay = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(d));
