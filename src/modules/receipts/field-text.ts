/**
 * O campo não vê valores. O descritivo vem da planilha e às vezes traz preço
 * no texto ("Hora extra R$ 350,00"); no envio, o valor vira um aviso neutro.
 */
const MONEY = /(?:R\$|US\$|€)\s*\d[\d.,]*(?:\s*(?:mil|milh(?:ão|ões)|k)\b)?/gi;

export const HIDDEN_VALUE = "(valor na pré-produção)";

export function fieldText(text: string): string;
export function fieldText(text: string | null): string | null;
export function fieldText(text: string | null) {
  return text === null ? null : text.replace(MONEY, HIDDEN_VALUE);
}
