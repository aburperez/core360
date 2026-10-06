import { requireActor, errorResponse } from "@/server/http/handler";
import { photoBytes, photoUrl } from "@/modules/attachments/attachments.service";

/** Abre a foto: confere o acesso e redireciona para um link assinado de 5 minutos. */
export async function GET(req: Request, ctx: { params: Promise<{ attachmentId: string }> }) {
  try {
    const actor = await requireActor(req);
    const { attachmentId } = await ctx.params;
    const direct = await photoBytes(actor, attachmentId);
    if (direct) {
      return new Response(new Blob([direct.body as BlobPart], { type: direct.mimeType }), {
        headers: { "content-type": direct.mimeType, "cache-control": "private, no-store" },
      });
    }
    const url = await photoUrl(actor, attachmentId);
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
