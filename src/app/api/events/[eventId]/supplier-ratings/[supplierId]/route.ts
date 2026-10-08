import { authed, body } from "@/server/http/handler";
import { rateSupplier } from "@/modules/suppliers/ratings.service";

/** Nota do fornecedor no evento: os 6 critérios (0 a 10) e um comentário (só o diretor). */
export const PUT = authed<{ eventId: string; supplierId: string }>(async ({ req, actor, params }) =>
  rateSupplier(actor, params.eventId, params.supplierId, await body(req)));
