import { after } from "next/server";
import { dispatch } from "../../modules/notifications/dispatcher";
import { workerPrisma } from "../db/client";
import { roleDatabaseUrl } from "../db/urls";
import { getWhatsApp, whatsappEnabled } from "../whatsapp/whatsapp";

/** Roda o despacho de avisos uma vez (rota do cron e após cada alteração). */
export function runDispatch() {
  return dispatch({ db: workerPrisma(), whatsapp: whatsappEnabled() ? getWhatsApp() : null });
}

/**
 * Agenda o despacho para DEPOIS da resposta: quem abriu o chamado não espera
 * o aviso sair. Se falhar, o cron da próxima rodada pega o que ficou na fila.
 */
export function scheduleDispatch() {
  if (!roleDatabaseUrl("worker")) return;
  try {
    after(() => runDispatch().catch((err) => console.error("Despacho de avisos falhou", err)));
  } catch {
    // Fora de uma requisição (scripts, testes): o cron cuida.
  }
}

const RUN_WHEN_IDLE_MS = 60_000;
const last = globalThis as unknown as { lastActivityDispatch?: number };

/**
 * Sem agendador de minuto em minuto (ex.: plano gratuito da Vercel), o próprio
 * uso do app puxa o despacho: o sino consulta a cada 30 s e, no máximo uma vez
 * por minuto por servidor, isso roda o despacho (SLA e lembretes do urgente).
 * Rodar a mais é seguro: a fila e as chaves de aviso impedem repetição.
 */
export function scheduleDispatchFromActivity() {
  const now = Date.now();
  if (now - (last.lastActivityDispatch ?? 0) < RUN_WHEN_IDLE_MS) return;
  last.lastActivityDispatch = now;
  scheduleDispatch();
}
