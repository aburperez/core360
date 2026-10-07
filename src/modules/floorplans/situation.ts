import type { PlanPointStatus } from "../../generated/prisma/enums";

export type PointSituation = PlanPointStatus | "ATRASADO";

/**
 * Atrasada: passou do início previsto e não começou, ou passou do fim
 * previsto e não terminou. Não fica guardado: muda sozinho com o relógio.
 */
export function pointSituation(
  p: { status: PlanPointStatus; startsAt: Date | string | null; endsAt: Date | string | null },
  now = new Date(),
): PointSituation {
  if (p.status === "CONCLUIDO") return "CONCLUIDO";
  const past = (d: Date | string | null) => !!d && new Date(d).getTime() < now.getTime();
  if (past(p.endsAt) || (p.status === "NAO_INICIADO" && past(p.startsAt))) return "ATRASADO";
  return p.status;
}
