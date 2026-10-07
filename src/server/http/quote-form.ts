import { MAX_QUOTE_FILE_BYTES, type QuoteFile } from "@/modules/quotes/quotes.service";
import { ValidationError } from "@/server/errors";

/**
 * Orçamento enviado como multipart: os campos em "data" (JSON) e o arquivo
 * recebido, opcional, em "file".
 */
export async function readQuoteForm(req: Request): Promise<{ input: unknown; file: QuoteFile | null }> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_QUOTE_FILE_BYTES + 256 * 1024) throw new ValidationError("Arquivo maior que 10 MB");
  const form = await req.formData().catch(() => null);
  if (!form) throw new ValidationError("Envie o formulário do orçamento");
  let input: unknown = {};
  try {
    input = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    throw new ValidationError("Dados do orçamento inválidos");
  }
  const f = form.get("file");
  const file = f instanceof File && f.size > 0 ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null;
  return { input, file };
}
