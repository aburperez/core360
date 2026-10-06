import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Botão "Assumir" da mensagem do WhatsApp. O payload leva o envio e uma
 * assinatura que só o servidor sabe gerar: ninguém monta um "Assumir" para um
 * chamado qualquer. Na volta, conferimos também que a resposta veio do mesmo
 * número que recebeu a mensagem, e o envio só vale uma vez.
 */

const PREFIX = "claim";

function secret(): string {
  const s = process.env.WHATSAPP_ACTION_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("Defina WHATSAPP_ACTION_SECRET (ou BETTER_AUTH_SECRET) com 32+ caracteres");
  return s;
}

function mac(deliveryId: string) {
  return createHmac("sha256", secret()).update(`${PREFIX}:${deliveryId}`).digest("base64url").slice(0, 32);
}

export function signClaim(deliveryId: string): string {
  return `${PREFIX}:${deliveryId}:${mac(deliveryId)}`;
}

/** Devolve o id do envio se a assinatura confere; senão null. */
export function verifyClaim(payload: string | undefined | null): string | null {
  const m = payload?.match(/^claim:([0-9a-f-]{36}):([A-Za-z0-9_-]{32})$/);
  if (!m) return null;
  const expected = Buffer.from(mac(m[1]));
  const got = Buffer.from(m[2]);
  return got.length === expected.length && timingSafeEqual(got, expected) ? m[1] : null;
}
