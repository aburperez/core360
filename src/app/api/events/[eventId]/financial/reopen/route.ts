import { authed, body } from "@/server/http/handler";
import { reopenFinancial } from "@/modules/finance/closing.service";

/** Reabre o financeiro: { reason } (fica na auditoria). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => reopenFinancial(actor, params.eventId, await body(req)));
