import { requireActor, errorResponse } from "@/server/http/handler";
import { historyPart } from "@/modules/closure/closure.service";

/** Uma parte do histórico do evento em ZIP (fase 6C; o serviço confere quem pode). */
export async function GET(req: Request, ctx: RouteContext<"/api/events/[eventId]/history/[part]">) {
  try {
    const actor = await requireActor(req);
    const { eventId, part } = await ctx.params;
    const z = await historyPart(actor, eventId, part);
    return new Response(z.bytes as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${z.fileName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
