/**
 * Contas do fechamento financeiro (fase 7B), sem nada do servidor para as
 * telas usarem igual. Entram os itens não opcionais com contratado ou
 * realizado:
 *
 *   Diferença = Realizado − Contratado (positivo = estouro)
 *   Pago      = soma do realizado dos itens marcados como pagos
 *   A pagar   = o que falta pagar (o realizado, ou o contratado sem realizado)
 *
 * Um item impede o fechamento enquanto não tem realizado, não está pago ou
 * passou do contratado sem motivo.
 */

export interface ClosingInput {
  contracted: number | null;
  actual: number | null;
  paidOn: string | null;
  overrunReason: string | null;
}

export type ClosingMissing = "REALIZADO" | "PAGAMENTO" | "MOTIVO";

const round = (n: number) => Math.round(n * 100) / 100;

export function closingLine(i: ClosingInput) {
  const diff = i.contracted !== null && i.actual !== null ? round(i.actual - i.contracted) : null;
  const missing: ClosingMissing[] = [];
  if (i.actual === null) missing.push("REALIZADO");
  if (!i.paidOn) missing.push("PAGAMENTO");
  if (diff !== null && diff > 0 && !i.overrunReason) missing.push("MOTIVO");
  return { contracted: i.contracted, actual: i.actual, paidOn: i.paidOn, diff, missing };
}
export type ClosingLine = ReturnType<typeof closingLine>;

export const MISSING_LABEL: Record<ClosingMissing, string> = {
  REALIZADO: "sem realizado",
  PAGAMENTO: "não pago",
  MOTIVO: "estouro sem motivo",
};

export function closingTotals(lines: ClosingLine[]) {
  const t = { items: 0, contracted: 0, actual: 0, paid: 0, toPay: 0, overrun: 0, overruns: 0, below: 0, withActual: 0, paidItems: 0, justified: 0, pending: 0 };
  for (const l of lines) {
    t.items++;
    t.contracted += l.contracted ?? 0;
    t.actual += l.actual ?? 0;
    if (l.actual !== null) t.withActual++;
    if (l.paidOn) {
      t.paid += l.actual ?? 0;
      t.paidItems++;
    } else {
      t.toPay += l.actual ?? l.contracted ?? 0;
    }
    if (l.diff !== null && l.diff > 0) {
      t.overrun += l.diff;
      t.overruns++;
      if (!l.missing.includes("MOTIVO")) t.justified++;
    }
    if (l.diff !== null && l.diff < 0) t.below += -l.diff;
    if (l.missing.length) t.pending++;
  }
  for (const k of ["contracted", "actual", "paid", "toPay", "overrun", "below"] as const) t[k] = round(t[k]);
  return t;
}
