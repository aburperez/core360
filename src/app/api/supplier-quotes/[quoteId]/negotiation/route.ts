import { authed, body } from "@/server/http/handler";
import { negotiateProposal } from "@/modules/quotes/quotes.service";

/** Valor negociado pelo diretor: { value, note }. Valor vazio desfaz a negociação. */
export const PUT = authed<{ quoteId: string }>(async ({ req, actor, params }) => negotiateProposal(actor, params.quoteId, await body(req)));
