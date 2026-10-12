/**
 * Contas da inteligência da agência (fase 7C), sem nada do servidor:
 *
 *   Custo do item   = o realizado; sem realizado, o contratado
 *   Por unidade     = custo ÷ quantidade (quando a quantidade é maior que zero)
 *   Por pessoa      = custo do evento ÷ público previsto da ficha
 *
 * A busca de preços compara palavras sem acento e sem as pequenas ("de",
 * "com"...), para "Palco 12x8 m" achar "palco 12x8" de outro evento.
 */

const SMALL = new Set(["de", "da", "do", "das", "dos", "com", "para", "por", "sem", "e", "em", "no", "na", "nos", "nas", "a", "o", "as", "os", "um", "uma"]);

export function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** As palavras que contam na comparação (2 letras ou mais, sem as pequenas). */
export function words(s: string): string[] {
  return [...new Set(normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !SMALL.has(w)))];
}

/** Quantas palavras do nome procurado aparecem no outro. */
export function matchScore(wanted: string[], name: string) {
  const have = new Set(words(name));
  return wanted.filter((w) => have.has(w)).length;
}

/** Busca do banco de preços: todas as palavras digitadas aparecem no item ou no fornecedor. */
export function matchesQuery(query: string, ...fields: (string | null)[]) {
  const ws = words(query);
  if (!ws.length) return true;
  const hay = normalize(fields.filter(Boolean).join(" "));
  return ws.every((w) => hay.includes(w));
}

export const itemCost = (i: { contracted: number | null; actual: number | null }) => i.actual ?? i.contracted;

export function unitPrice(cost: number | null, quantity: number) {
  return cost !== null && quantity > 0 ? Math.round((cost / quantity) * 100) / 100 : null;
}

export function perPerson(cost: number, audience: number | null) {
  return audience && audience > 0 && cost > 0 ? Math.round((cost / audience) * 100) / 100 : null;
}

/** Menor, média e maior de uma lista (vazia: null). */
export function spread(values: number[]) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return { min: Math.min(...values), avg: Math.round((sum / values.length) * 100) / 100, max: Math.max(...values), n: values.length };
}
