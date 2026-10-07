import { authed, body } from "@/server/http/handler";
import { setQuoteState } from "@/modules/quotes/quotes.service";

/** Cancelar ou reabrir a cotação (só o gestor). */
export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) =>
  setQuoteState(actor, params.requestId, await body(req)),
);
