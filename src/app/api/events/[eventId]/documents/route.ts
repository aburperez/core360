import { authed } from "@/server/http/handler";
import { addDocument, listDocuments } from "@/modules/documents/documents.service";
import { maxDocumentBytes } from "@/modules/documents/file";
import { formatBytes } from "@/lib/documents";
import { ValidationError } from "@/server/errors";

/** Documentos do evento (Pré-produção). */
export const GET = authed<{ eventId: string }>(({ actor, params }) => listDocuments(actor, params.eventId));

/** Enviar documento (multipart: "file", "category", "title" e "visibleToField"). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const max = maxDocumentBytes();
  if (Number(req.headers.get("content-length") ?? 0) > max + 64 * 1024) throw new ValidationError(`Arquivo maior que ${formatBytes(max)}`);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ValidationError("Escolha o arquivo");
  const text = (k: string) => (typeof form?.get(k) === "string" ? (form.get(k) as string) : undefined);
  return addDocument(
    actor, params.eventId,
    { category: text("category"), title: text("title"), visibleToField: text("visibleToField") === "true" },
    { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name },
  );
}, { status: 201 });
