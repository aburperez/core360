import { authed } from "@/server/http/handler";
import { importCostSheet } from "@/modules/costs/costs.service";
import { MAX_IMPORT_BYTES } from "@/modules/costs/matrix";
import { ValidationError } from "@/server/errors";

/**
 * Importa a matriz de orçamento (multipart: campo "file").
 * Sem "confirm=1" só devolve a prévia; com ele, substitui a planilha do evento.
 */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 64 * 1024) throw new ValidationError("Planilha maior que 2 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("Envie a planilha no campo 'file'");
  if (file.size > MAX_IMPORT_BYTES) throw new ValidationError("Planilha maior que 2 MB");
  return importCostSheet(actor, params.eventId, new Uint8Array(await file.arrayBuffer()), {
    confirm: form?.get("confirm") === "1",
    fileName: file instanceof File ? file.name : null,
  });
});
