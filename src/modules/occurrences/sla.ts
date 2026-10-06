import type { Priority } from "../../generated/prisma/enums";

/** Prazos padrão criados com cada evento; editáveis por evento em sla_policies. */
export const DEFAULT_SLA_MINUTES: Record<Priority, number> = {
  CRITICA: 15,
  ALTA: 60,
  NORMAL: 240,
  BAIXA: 1440,
};

export function slaDueAt(openedAt: Date, targetMinutes: number | undefined | null): Date | null {
  return targetMinutes ? new Date(openedAt.getTime() + targetMinutes * 60_000) : null;
}

/**
 * Prazo do chamado em minutos. Com tipo de atendimento de SLA aprovado, vale o
 * do tipo; Crítica nunca fica mais lenta que o prazo de Crítica do evento.
 * Sem tipo (ou tipo sem SLA), vale o prazo da prioridade, como antes.
 */
export function targetMinutes(priority: Priority, priorityMinutes: number | null | undefined, typeMinutes: number | null | undefined) {
  if (!typeMinutes) return priorityMinutes ?? null;
  if (priority === "CRITICA" && priorityMinutes) return Math.min(typeMinutes, priorityMinutes);
  return typeMinutes;
}
