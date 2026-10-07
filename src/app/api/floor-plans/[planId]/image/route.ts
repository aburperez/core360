import { requireActor, errorResponse } from "@/server/http/handler";
import { planImage } from "@/modules/floorplans/floorplans.service";

/**
 * A imagem da planta, depois de conferir o acesso. Pode ficar no navegador da
 * pessoa por um dia (a planta pesa e o sinal no campo é fraco); uma planta
 * nova tem outro endereço.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/floor-plans/[planId]/image">) {
  try {
    const actor = await requireActor(req);
    const { planId } = await ctx.params;
    const p = await planImage(actor, planId);
    if (p.body) {
      return new Response(new Blob([p.body as BlobPart], { type: p.mimeType }), {
        headers: { "content-type": p.mimeType, "cache-control": "private, max-age=86400" },
      });
    }
    return new Response(null, { status: 302, headers: { location: p.url!, "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
