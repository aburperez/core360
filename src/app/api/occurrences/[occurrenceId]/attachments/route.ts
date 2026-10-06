import { authed } from "@/server/http/handler";
import { addPhoto, MAX_PHOTO_BYTES } from "@/modules/attachments/attachments.service";
import { ValidationError } from "@/server/errors";

/** Upload de foto (multipart: campo "file"; opcionais "kind", "width", "height"). */
export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES + 64 * 1024) throw new ValidationError("Foto maior que 10 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("Envie o arquivo no campo 'file'");
  const kind = form?.get("kind") === "CONCLUSAO" ? "CONCLUSAO" : "EVIDENCIA";
  const num = (k: string) => {
    const n = Number(form?.get(k));
    return Number.isInteger(n) && n > 0 && n < 20000 ? n : null;
  };
  const a = await addPhoto(actor, params.occurrenceId, {
    bytes: new Uint8Array(await file.arrayBuffer()),
    kind,
    width: num("width"),
    height: num("height"),
  });
  return { id: a.id, kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes, createdAt: a.createdAt };
}, { status: 201 });
