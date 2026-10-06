import { after } from "next/server";
import { dispatch } from "../../modules/notifications/dispatcher";
import { workerPrisma } from "../db/client";
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
  if (!process.env.WORKER_DATABASE_URL) return;
  try {
    after(() => runDispatch().catch((err) => console.error("Despacho de avisos falhou", err)));
  } catch {
    // Fora de uma requisição (scripts, testes): o cron cuida.
  }
}
