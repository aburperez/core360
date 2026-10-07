import { authed } from "@/server/http/handler";
import { addPointPhoto } from "@/modules/floorplans/floorplans.service";
import { MAX_PHOTO_BYTES } from "@/modules/attachments/attachments.service";
import { ValidationError } from "@/server/errors";

/** Foto da etapa (multipart: campo "file"). */
export const POST = authed<{ pointId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES + 64 * 1024) throw new ValidationError("Foto maior que 10 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("Envie o arquivo no campo 'file'");
  return addPointPhoto(actor, params.pointId, new Uint8Array(await file.arrayBuffer()));
}, { status: 201 });
