import { authed, body, requireActor, errorResponse } from "@/server/http/handler";
import { deleteVisitPhoto, updatePhotoCaption, visitPhoto } from "@/modules/visits/report.service";

/** Abre a foto da visita, depois de conferir o acesso. */
export async function GET(req: Request, ctx: RouteContext<"/api/visit-photos/[photoId]">) {
  try {
    const actor = await requireActor(req);
    const { photoId } = await ctx.params;
    const p = await visitPhoto(actor, photoId);
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

/** Legenda da foto. */
export const PATCH = authed<{ photoId: string }>(async ({ req, actor, params }) =>
  updatePhotoCaption(actor, params.photoId, await body(req)),
);

export const DELETE = authed<{ photoId: string }>(({ actor, params }) => deleteVisitPhoto(actor, params.photoId));
