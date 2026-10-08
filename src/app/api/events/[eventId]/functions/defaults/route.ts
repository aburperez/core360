import { authed, body } from "@/server/http/handler";
import { createDefaultFunctions } from "@/modules/functions/functions.service";

/** Cria as funções escolhidas da lista padrão (ou todas as que faltam). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  createDefaultFunctions(actor, params.eventId, await body(req)),
);
