import { authed } from "@/server/http/handler";
import { readQuoteForm } from "@/server/http/quote-form";
import { deleteSupplierQuote, updateSupplierQuote } from "@/modules/quotes/quotes.service";

/** Corrige o orçamento e, se vier "file", troca o arquivo. */
export const PATCH = authed<{ quoteId: string }>(async ({ req, actor, params }) => {
  const { input, file } = await readQuoteForm(req);
  return updateSupplierQuote(actor, params.quoteId, input, file);
});

export const DELETE = authed<{ quoteId: string }>(({ actor, params }) => deleteSupplierQuote(actor, params.quoteId));
