import { authed, body } from "@/server/http/handler";
import { markQuoteSent } from "@/modules/quotes/quotes.service";

/** "Enviei aos fornecedores": avisa o gestor para definir o prazo. */
export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) =>
  markQuoteSent(actor, params.requestId, await body(req)),
);
