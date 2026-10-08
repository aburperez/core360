/**
 * As 11 etapas do evento (roadmap do Abu), na ordem, mais Cancelado. Sem
 * banco: serve para a tela e para o servidor.
 */
export const EVENT_STAGES = [
  { key: "BRIEFING", label: "Briefing" },
  { key: "PLANEJAMENTO", label: "Planejamento" },
  { key: "ORCAMENTO", label: "Orçamento" },
  { key: "APROVACAO", label: "Aprovação" },
  { key: "CONTRATACAO", label: "Contratação" },
  { key: "PRE_PRODUCAO", label: "Pré-produção" },
  { key: "MONTAGEM", label: "Montagem" },
  { key: "EVENTO", label: "Evento" },
  { key: "DESMONTAGEM", label: "Desmontagem" },
  { key: "FECHAMENTO", label: "Fechamento" },
  { key: "CONCLUIDO", label: "Concluído" },
] as const;

export const EVENT_STATUSES = [...EVENT_STAGES.map((s) => s.key), "CANCELADO"] as const;
export type EventStage = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABEL: Record<string, string> = {
  ...Object.fromEntries(EVENT_STAGES.map((s) => [s.key, s.label])),
  CANCELADO: "Cancelado",
};

/** Posição da etapa (1 a 11); Cancelado não tem. */
export function stageNumber(status: string): number | null {
  const i = EVENT_STAGES.findIndex((s) => s.key === status);
  return i < 0 ? null : i + 1;
}

/** Sugestões para o tipo de evento (o campo aceita outro texto). */
export const EVENT_TYPES = [
  "Corporativo", "Convenção", "Congresso", "Feira", "Lançamento", "Show", "Festival", "Esportivo", "Social", "Ativação de marca",
] as const;

/** Sugestões de centro de custo (o campo aceita outro texto). */
export const COST_CENTERS = [
  "01 Infra", "02 Ceno", "03 Técnica", "04 Operação", "05 Logística", "06 Staff", "07 Produção", "08 Administrativo",
] as const;

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS",
  "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
