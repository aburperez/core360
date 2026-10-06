import { requireActor, errorResponse } from "@/server/http/handler";
import { exportCostSheet } from "@/modules/costs/costs.service";

/** Baixar Excel: a planilha de custos no layout da matriz de orçamento. */
export async function GET(req: Request, ctx: RouteContext<"/api/events/[eventId]/costs/export">) {
  try {
    const actor = await requireActor(req);
    const { eventId } = await ctx.params;
    const { fileName, bytes } = await exportCostSheet(actor, eventId);
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
