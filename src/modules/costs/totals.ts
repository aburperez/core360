/**
 * Contas da planilha de custos, iguais às fórmulas da matriz de orçamento:
 *
 *   subtotal do item  = valor unitário × quantidade × frequência (sem frequência, × 1)
 *   fornecedores      = direto + fatura + nota fiscal
 *   honorários        = fornecedores × honorários%
 *   encargos fatura   = fatura / (1 − encargos%) − fatura
 *   encargos NF       = (NF + honorários) / (1 − encargos NF%) − (NF + honorários)
 *   total             = direto + (fatura + encargos) + (NF + honorários + encargos NF)
 *
 * Itens opcionais aparecem na planilha, mas ficam fora dos totais (na matriz,
 * o subtotal deles é o texto "OPCIONAL", que a SOMASE ignora).
 * As contas são feitas em ponto flutuante, como o Excel; o arredondamento
 * para centavos é só na hora de mostrar.
 */

export type CostBilling = "FATURA" | "NOTA_FISCAL" | "DIRETO";

export const BILLING_LABEL: Record<CostBilling, string> = {
  FATURA: "Fatura",
  NOTA_FISCAL: "Nota fiscal",
  DIRETO: "Direto",
};

export interface CostLine {
  unitValue: number;
  quantity: number;
  frequency: number | null;
  optional: boolean;
  billing: CostBilling;
}

export interface CostRates {
  /** Percentuais como na planilha: 15 = 15%. */
  feePct: number;
  invoiceTaxPct: number;
  nfTaxPct: number;
}

export const DEFAULT_RATES: CostRates = { feePct: 15, invoiceTaxPct: 9.5, nfTaxPct: 17.5 };

export const lineSubtotal = (i: Pick<CostLine, "unitValue" | "quantity" | "frequency">) =>
  i.unitValue * i.quantity * (i.frequency ?? 1);

/** "Por dentro": o valor que, tirado o encargo, sobra `base`. */
const grossUp = (base: number, pct: number) => base / (1 - pct / 100) - base;

export function costTotals(items: CostLine[], rates: CostRates) {
  const by: Record<CostBilling, number> = { FATURA: 0, NOTA_FISCAL: 0, DIRETO: 0 };
  let optional = 0;
  for (const i of items) {
    const v = lineSubtotal(i);
    if (i.optional) optional += v;
    else by[i.billing] += v;
  }
  const suppliers = by.DIRETO + by.FATURA + by.NOTA_FISCAL;
  const fee = suppliers * (rates.feePct / 100);
  const invoiceTax = grossUp(by.FATURA, rates.invoiceTaxPct);
  const invoiceTotal = by.FATURA + invoiceTax;
  const nfTax = grossUp(by.NOTA_FISCAL + fee, rates.nfTaxPct);
  const nfTotal = by.NOTA_FISCAL + fee + nfTax;
  return {
    direct: by.DIRETO,
    invoice: by.FATURA,
    nf: by.NOTA_FISCAL,
    suppliers,
    fee,
    invoiceTax,
    invoiceTotal,
    nfTax,
    nfTotal,
    total: by.DIRETO + invoiceTotal + nfTotal,
    /** Soma dos opcionais, se todos fossem contratados (só informativo). */
    optional,
  };
}

export type CostTotals = ReturnType<typeof costTotals>;
