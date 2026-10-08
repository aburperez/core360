import { authed, body } from "@/server/http/handler";
import { deleteVisit, updateVisit } from "@/modules/visits/visits.service";
import { getVisitReport } from "@/modules/visits/report.service";

/** A visita com o relatório e as fotos. */
export const GET = authed<{ visitId: string }>(({ actor, params }) => getVisitReport(actor, params.visitId));

export const PATCH = authed<{ visitId: string }>(async ({ req, actor, params }) =>
  updateVisit(actor, params.visitId, await body(req)),
);

export const DELETE = authed<{ visitId: string }>(({ actor, params }) => deleteVisit(actor, params.visitId));
