import { authed, body } from "@/server/http/handler";
import { updatePayment } from "@/modules/finance/closing.service";

/** Fechamento financeiro: realizado, pago em, nota fiscal e motivo do estouro. */
export const PATCH = authed<{ itemId: string }>(async ({ req, actor, params }) => updatePayment(actor, params.itemId, await body(req)));
