import { timingSafeEqual } from "node:crypto";
import { runDispatch } from "@/server/notify/kick";

/**
 * Chamado a cada minuto por um agendador (cron da hospedagem):
 * processa a fila, confere SLA e reenvia o que falhou no WhatsApp.
 * Protegido por "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return Response.json({ error: { code: "DISABLED", message: "CRON_SECRET não configurado" } }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Não autorizado" } }, { status: 401 });
  }
  const result = await runDispatch();
  return Response.json({ data: result });
}
