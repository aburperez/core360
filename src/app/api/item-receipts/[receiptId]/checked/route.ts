import { authed } from "@/server/http/handler";
import { markChecked, uncheck } from "@/modules/receipts/receipts.service";
import { MAX_PHOTO_BYTES } from "@/modules/attachments/attachments.service";
import { ValidationError } from "@/server/errors";

/** Conferido (fase 5B): só com a foto (multipart: campo "file"). */
export const POST = authed<{ receiptId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_PHOTO_BYTES + 64 * 1024) throw new ValidationError("Foto maior que 10 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("O conferido pede uma foto");
  return markChecked(actor, params.receiptId, new Uint8Array(await file.arrayBuffer()));
});

/** Desfaz o Conferido. */
export const DELETE = authed<{ receiptId: string }>(({ actor, params }) => uncheck(actor, params.receiptId));
