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
