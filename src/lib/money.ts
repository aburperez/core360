const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** R$ 1.234,56 */
export const brl = (n: number) => BRL.format(n);

/** 1.234,5 (quantidade, frequência, percentual) */
export const decimal = (n: number) => NUM.format(n);

/** Número digitado ou vindo de planilha: "1.234,56", "R$ 100", "15%", "2.5" ou "1". */
export function parseDecimal(s: string): number | null {
  let t = s.replace(/R\$|\s|%/g, "");
  if (!t || !/^-?[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
