import { requireActor, errorResponse } from "@/server/http/handler";
import { documentFile } from "@/modules/documents/documents.service";

/** Abre (PDF e imagem) ou baixa (Office) o documento, depois de conferir o acesso. */
export async function GET(req: Request, ctx: RouteContext<"/api/documents/[documentId]/file">) {
  try {
    const actor = await requireActor(req);
    const { documentId } = await ctx.params;
    const f = await documentFile(actor, documentId);
    if (f.body) {
      const name = encodeURIComponent(f.fileName);
      return new Response(new Blob([f.body as BlobPart], { type: f.mimeType }), {
        headers: {
          "content-type": f.mimeType,
          "content-disposition": `${f.inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
          "x-content-type-options": "nosniff",
          // O arquivo veio de fora: nada dele roda como página do app. (O leitor de PDF do
          // Chrome não abre com "sandbox", e ele já roda isolado.)
          ...(f.mimeType !== "application/pdf" && { "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
          "cache-control": "private, no-store",
        },
      });
    }
    return new Response(null, { status: 302, headers: { location: f.url!, "cache-control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
