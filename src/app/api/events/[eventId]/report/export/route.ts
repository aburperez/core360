import { requireActor, errorResponse } from "@/server/http/handler";
import { exportDailyReport } from "@/modules/reports/reports.service";

/** Baixar Excel do relatório do dia. */
export async function GET(req: Request, ctx: RouteContext<"/api/events/[eventId]/report/export">) {
  try {
    const actor = await requireActor(req);
    const { eventId } = await ctx.params;
    const { fileName, bytes } = await exportDailyReport(actor, eventId, new URL(req.url).searchParams.get("dia"));
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
