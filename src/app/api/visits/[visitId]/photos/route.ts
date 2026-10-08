import { authed } from "@/server/http/handler";
import { addVisitPhoto } from "@/modules/visits/report.service";
import { MAX_PHOTO_BYTES } from "@/modules/attachments/attachments.service";
import { ValidationError } from "@/server/errors";

/** Foto da visita (multipart: campo "file" e, se quiser, "caption"). */
export const POST = authed<{ visitId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES + 64 * 1024) throw new ValidationError("Foto maior que 10 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("Envie o arquivo no campo 'file'");
  const caption = form?.get("caption");
  return addVisitPhoto(actor, params.visitId, new Uint8Array(await file.arrayBuffer()), typeof caption === "string" ? caption : null);
}, { status: 201 });
