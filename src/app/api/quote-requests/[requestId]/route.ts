import { authed, body } from "@/server/http/handler";
import { getQuote, updateQuote } from "@/modules/quotes/quotes.service";

export const GET = authed<{ requestId: string }>(({ actor, params }) => getQuote(actor, params.requestId));

export const PATCH = authed<{ requestId: string }>(async ({ req, actor, params }) =>
  updateQuote(actor, params.requestId, await body(req)),
);
