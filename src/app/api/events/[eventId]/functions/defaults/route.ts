import { authed } from "@/server/http/handler";
import { createDefaultFunctions } from "@/modules/functions/functions.service";

/** Cria as funções da lista padrão que o evento ainda não tem. */
export const POST = authed<{ eventId: string }>(({ actor, params }) => createDefaultFunctions(actor, params.eventId));
