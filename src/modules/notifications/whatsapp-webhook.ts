import type { PrismaClient } from "../../generated/prisma/client";
import { loadActor } from "../../server/authz/actor";
import { ConflictError, ForbiddenError, NotFoundError } from "../../server/errors";
import { verifyClaim } from "../../server/whatsapp/actions";
import type { WhatsApp } from "../../server/whatsapp/whatsapp";
import { phoneDigits } from "../../lib/phone";
import { claimOccurrence } from "../occurrences/occurrences.service";
import { appUrl } from "./dispatcher";

/**
 * Mensagens que chegam do WhatsApp (webhook da Meta). Hoje só tratamos o
 * botão "Assumir". A assinatura do webhook é conferida antes, na rota.
 *
 * Para assumir pelo WhatsApp, TUDO precisa bater:
 *  - o payload do botão tem a assinatura do servidor (verifyClaim);
 *  - a resposta veio do mesmo número para o qual a mensagem foi enviada;
 *  - o botão ainda não foi usado e a mensagem tem menos de 24 h;
 *  - a pessoa continua ativa e pode assumir (mesma regra do app: claimOccurrence).
 */

interface WebhookBody {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; type?: string; button?: { payload?: string }; interactive?: { button_reply?: { id?: string } } }[];
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
      };
    }[];
  }[];
}

export interface WebhookDeps {
  worker: PrismaClient;
  app: PrismaClient;
  whatsapp: WhatsApp;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60_000;

export async function handleWhatsAppWebhook(payload: unknown, deps: WebhookDeps) {
  const body = (payload ?? {}) as WebhookBody;
  const results: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        const data = msg.button?.payload ?? msg.interactive?.button_reply?.id;
        if (!msg.from || !data) continue;
        results.push(await handleClaim(msg.from, data, deps));
      }
      for (const st of change.value?.statuses ?? []) {
        if (st.status !== "failed" || !st.id) continue;
        const reason = st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? "falhou na entrega";
        await deps.worker.notificationDelivery.updateMany({
          where: { providerMessageId: st.id },
          data: { status: "FALHOU", lastError: reason.slice(0, 500) },
        });
      }
    }
  }
  return results;
}

async function handleClaim(from: string, payload: string, deps: WebhookDeps): Promise<string> {
  const { worker, whatsapp } = deps;
  const now = deps.now?.() ?? new Date();
  const reply = async (text: string, result: string) => {
    await whatsapp.sendText(`+${phoneDigits(from)}`, text).catch((e) => console.error("WhatsApp: resposta falhou", e));
    return result;
  };

  const deliveryId = verifyClaim(payload);
  // Payload forjado: não responde nada (não confirma que o número existe).
  if (!deliveryId) return "assinatura-invalida";

  const d = await worker.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: { notification: { select: { userId: true, occurrenceId: true } } },
  });
  if (!d || phoneDigits(d.toPhone) !== phoneDigits(from)) return "numero-diferente";
  if (!d.sentAt || now.getTime() - d.sentAt.getTime() > DAY_MS) return reply("Este botão expirou. Abra o chamado pelo app.", "expirado");

  // Marca como usado de forma atômica: dois toques seguidos não assumem duas vezes.
  const used = await worker.notificationDelivery.updateMany({
    where: { id: d.id, actionUsedAt: null },
    data: { actionUsedAt: now },
  });
  if (used.count === 0) return reply("Este botão já foi usado.", "ja-usado");

  const occurrenceId = d.notification.occurrenceId;
  const actor = await loadActor(deps.app, d.notification.userId, { userAgent: "WhatsApp (botão Assumir)" });
  if (!actor || !occurrenceId) return reply("Seu acesso ao CORE 360 está desativado. Fale com o gerente do evento.", "inativo");

  try {
    const o = await claimOccurrence(actor, occurrenceId);
    const link = `${appUrl()}/c/${o.id}`;
    return reply(`Pronto: o chamado #${o.number} agora é seu. Abra no app: ${link}`, "assumido");
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof ConflictError) {
      return reply("Este chamado já tem responsável ou não pode mais ser assumido.", "recusado");
    }
    if (err instanceof NotFoundError) return reply("Você não tem mais acesso a este chamado.", "sem-acesso");
    throw err;
  }
}
