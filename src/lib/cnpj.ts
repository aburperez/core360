/** CNPJ: só os 14 dígitos, conferindo os dois dígitos verificadores. */
export function normalizeCnpj(input: string | null | undefined): string | null {
  const d = (input ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null;
  const check = (len: number) => {
    let sum = 0;
    let w = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * w--;
      if (w < 2) w = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]) ? d : null;
}

/** 12.345.678/0001-90 */
export function formatCnpj(d: string): string {
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}
