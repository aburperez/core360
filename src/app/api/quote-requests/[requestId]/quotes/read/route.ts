import { authed } from "@/server/http/handler";
import { readQuoteForm } from "@/server/http/quote-form";
import { readQuoteWithAi } from "@/modules/quotes/quotes.service";

/** A IA lê o arquivo do orçamento (multipart "file") e devolve os campos. Não salva nada. */
export const maxDuration = 60;

export const POST = authed<{ requestId: string }>(async ({ req, actor, params }) => {
  const { file } = await readQuoteForm(req);
  return readQuoteWithAi(actor, params.requestId, file);
});
