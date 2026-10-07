import { authed, errorResponse, requireActor } from "@/server/http/handler";
import { exportFunctionsSheet, importFunctionsSheet } from "@/modules/functions/functions-sheet.service";
import { MAX_SHEET_BYTES } from "@/modules/functions/spreadsheet";
import { ValidationError } from "@/server/errors";

/** Baixar planilha: áreas e equipes, funções e atividades do evento, no modelo padrão. */
export async function GET(req: Request, ctx: RouteContext<"/api/events/[eventId]/functions/sheet">) {
  try {
    const actor = await requireActor(req);
    const { eventId } = await ctx.params;
    const { fileName, bytes } = await exportFunctionsSheet(actor, eventId);
    // Só ASCII: com acento no filename*, o Chrome pode trocar o nome por "download".
    const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\/]/g, "");
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${ascii}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Enviar planilha (multipart: campo "file"). Sem "confirm=1" só devolve a
 * prévia do que vai mudar; com ele, grava (cria e atualiza, nunca apaga).
 */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_SHEET_BYTES + 64 * 1024) throw new ValidationError("Planilha maior que 2 MB");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) throw new ValidationError("Envie a planilha no campo 'file'");
  if (file.size > MAX_SHEET_BYTES) throw new ValidationError("Planilha maior que 2 MB");
  return importFunctionsSheet(actor, params.eventId, new Uint8Array(await file.arrayBuffer()), { confirm: form?.get("confirm") === "1" });
});
