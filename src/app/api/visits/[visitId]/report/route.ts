import { authed, body } from "@/server/http/handler";
import { updateReport } from "@/modules/visits/report.service";

/** Briefing do lugar (relatório da visita). */
export const PATCH = authed<{ visitId: string }>(async ({ req, actor, params }) =>
  updateReport(actor, params.visitId, await body(req)),
);
