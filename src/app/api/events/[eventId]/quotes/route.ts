import { authed, body } from "@/server/http/handler";
import { createQuote, listQuotes } from "@/modules/quotes/quotes.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => listQuotes(actor, params.eventId));

/** Novo pedido de cotação neste evento. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  createQuote(actor, params.eventId, await body(req)),
{ status: 201 });
