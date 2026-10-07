import { authed, body } from "@/server/http/handler";
import { setQuoteSla } from "@/modules/quotes/quotes.service";

/** O gestor define o prazo para os orçamentos. */
export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) =>
  setQuoteSla(actor, params.requestId, await body(req)),
);
