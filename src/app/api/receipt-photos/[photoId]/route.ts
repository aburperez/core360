import { requireActor, errorResponse } from "@/server/http/handler";
import { receiptPhoto } from "@/modules/receipts/receipts.service";

/** Abre a foto da conferência, depois de conferir o acesso. */
export async function GET(req: Request, ctx: RouteContext<"/api/receipt-photos/[photoId]">) {
  try {
    const actor = await requireActor(req);
    const { photoId } = await ctx.params;
    const p = await receiptPhoto(actor, photoId);
    if (p.body) {
      return new Response(new Blob([p.body as BlobPart], { type: p.mimeType }), {
        headers: { "content-type": p.mimeType, "cache-control": "private, no-store" },
      });
    }
    return new Response(null, { status: 302, headers: { location: p.url!, "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
