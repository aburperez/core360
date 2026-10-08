/**
 * Contas do Orçamento com os 4 valores (fase 2B do roadmap), sem nada do
 * servidor para as telas usarem igual:
 *
 *   Estimado   = unitário × quantidade × frequência (a planilha Padrão CORE 360)
 *   Cotado     = o menor orçamento da cotação do item; sem orçamento, o digitado
 *   Contratado = o orçamento escolhido pelo diretor, ou digitado por ele
 *   Realizado  = digitado pelo diretor quando o fornecedor é pago
 *   Saving     = Estimado − Contratado (só itens com os dois)
 *   Estouro    = Realizado − Contratado (só itens com os dois)
 *
 * Itens opcionais aparecem, mas ficam fora dos totais, como na planilha.
 */

export interface BudgetLine {
  estimated: number | null;
  quoted: number | null;
  contracted: number | null;
  actual: number | null;
  optional: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function lineSaving(l: Pick<BudgetLine, "estimated" | "contracted">) {
  return l.estimated !== null && l.contracted !== null ? round(l.estimated - l.contracted) : null;
}

export function lineOverrun(l: Pick<BudgetLine, "contracted" | "actual">) {
  return l.contracted !== null && l.actual !== null ? round(l.actual - l.contracted) : null;
}

export interface BudgetTotals {
  estimated: number;
  quoted: number;
  contracted: number;
  actual: number;
  /** Soma dos savings dos itens que já têm contratado (negativo = contratou acima do estimado). */
  saving: number;
  /** Soma dos estouros dos itens que já têm realizado (negativo = pagou menos que o contratado). */
  overrun: number;
  items: number;
  withQuoted: number;
  withContracted: number;
  withActual: number;
}

export function budgetTotals(lines: BudgetLine[]): BudgetTotals {
  const t: BudgetTotals = { estimated: 0, quoted: 0, contracted: 0, actual: 0, saving: 0, overrun: 0, items: 0, withQuoted: 0, withContracted: 0, withActual: 0 };
  for (const l of lines) {
    if (l.optional) continue;
    t.items++;
    t.estimated += l.estimated ?? 0;
    t.quoted += l.quoted ?? 0;
    t.contracted += l.contracted ?? 0;
    t.actual += l.actual ?? 0;
    if (l.quoted !== null) t.withQuoted++;
    if (l.contracted !== null) t.withContracted++;
    if (l.actual !== null) t.withActual++;
    t.saving += lineSaving(l) ?? 0;
    t.overrun += lineOverrun(l) ?? 0;
  }
  for (const k of ["estimated", "quoted", "contracted", "actual", "saving", "overrun"] as const) t[k] = round(t[k]);
  return t;
}

/** Quanto do orçamento aprovado já está contratado, em %. */
export function approvedUse(contracted: number, approved: number | null) {
  return approved && approved > 0 ? Math.round((contracted / approved) * 1000) / 10 : null;
}
