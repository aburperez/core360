import { authed, body } from "@/server/http/handler";
import { chooseQuote } from "@/modules/quotes/quotes.service";

/** O gestor escolhe o orçamento (com motivo quando não é o de menor valor). */
export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) =>
  chooseQuote(actor, params.requestId, await body(req)),
);
