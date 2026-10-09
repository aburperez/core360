import { requireActor, errorResponse } from "@/server/http/handler";
import { NotFoundError } from "@/server/errors";
import { isReportKey } from "@/modules/reports/catalog";
import { buildReport } from "@/modules/reports/build.service";
import { reportFileName, writeReportXlsx } from "@/modules/reports/report-xlsx";

/** Baixar o Excel de um relatório da fase 6B (o serviço confere quem pode). */
export async function GET(req: Request, ctx: RouteContext<"/api/events/[eventId]/reports/[report]">) {
  try {
    const actor = await requireActor(req);
    const { eventId, report } = await ctx.params;
    if (!isReportKey(report)) throw new NotFoundError("Relatório");
    const r = await buildReport(actor, eventId, report);
    return new Response((await writeReportXlsx(r)) as BodyInit, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${reportFileName(r)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
