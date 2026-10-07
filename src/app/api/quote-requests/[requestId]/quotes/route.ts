import { authed } from "@/server/http/handler";
import { readQuoteForm } from "@/server/http/quote-form";
import { addSupplierQuote } from "@/modules/quotes/quotes.service";

/** Novo orçamento (multipart: "data" com os campos e "file" opcional). */
export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) => {
  const { input, file } = await readQuoteForm(req);
  return addSupplierQuote(actor, params.requestId, input, file);
}, { status: 201 });
