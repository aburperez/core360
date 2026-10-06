/**
 * Normaliza um telefone para o formato internacional (E.164, ex.: +5511987654321).
 * Sem código de país, assume Brasil (+55). Devolve null se não parecer um celular válido.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+")) {
    digits = digits.replace(/^0+/, "");
    // DDD + número (10 ou 11 dígitos) → Brasil.
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  }
  if (!/^[1-9]\d{9,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** Só os dígitos (formato que o WhatsApp usa no campo "from"). */
export const phoneDigits = (phone: string) => phone.replace(/\D/g, "");

/** +5511987654321 → +55 11 98765-4321 (para exibir). */
export function formatPhone(phone: string): string {
  const m = phone.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : phone;
}
