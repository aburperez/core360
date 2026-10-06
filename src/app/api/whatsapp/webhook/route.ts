import { timingSafeEqual } from "node:crypto";
import { appPrisma, workerPrisma } from "@/server/db/client";
import { getWhatsApp, verifyWebhookSignature } from "@/server/whatsapp/whatsapp";
import { scheduleDispatch } from "@/server/notify/kick";
import { handleWhatsAppWebhook } from "@/modules/notifications/whatsapp-webhook";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Verificação do webhook pela Meta (feita uma vez, ao cadastrar a URL). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const token = q.get("hub.verify_token") ?? "";
  if (q.get("hub.mode") === "subscribe" && expected && same(token, expected)) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

/** Mensagens e status de entrega. Só aceita o que vier assinado pela Meta. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET ?? "")) {
    return new Response("assinatura inválida", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }
  try {
    await handleWhatsAppWebhook(payload, { worker: workerPrisma(), app: appPrisma(), whatsapp: getWhatsApp() });
    scheduleDispatch();
  } catch (err) {
    // A Meta reenvia em caso de erro; o botão é de uso único, então não há risco de repetir.
    console.error("Webhook do WhatsApp falhou", err);
    return new Response("erro", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
