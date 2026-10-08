import { authed, body } from "@/server/http/handler";
import { setProposalStatus } from "@/modules/quotes/quotes.service";

/** Andamento da proposta: { action: "NEGOCIACAO" | "CANCELAR" | "REATIVAR" }. */
export const POST = authed<{ quoteId: string }>(async ({ req, actor, params }) => setProposalStatus(actor, params.quoteId, await body(req)));
