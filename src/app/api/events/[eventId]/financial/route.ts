import { authed } from "@/server/http/handler";
import { closeFinancial } from "@/modules/finance/closing.service";

/** Fecha o financeiro do evento (trava os valores). */
export const POST = authed<{ eventId: string }>(async ({ actor, params }) => closeFinancial(actor, params.eventId));
