import { requireActor, errorResponse } from "@/server/http/handler";
import { quoteFile } from "@/modules/quotes/quotes.service";

/** Abre o arquivo do orçamento, depois de conferir o acesso. */
export async function GET(req: Request, ctx: RouteContext<"/api/supplier-quotes/[quoteId]/file">) {
  try {
    const actor = await requireActor(req);
    const { quoteId } = await ctx.params;
    const f = await quoteFile(actor, quoteId);
    if (f.body) {
      const name = encodeURIComponent(f.fileName);
      return new Response(new Blob([f.body as BlobPart], { type: f.mimeType }), {
        headers: {
          "content-type": f.mimeType,
          "content-disposition": `inline; filename*=UTF-8''${name}`,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    }
    return new Response(null, { status: 302, headers: { location: f.url!, "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
