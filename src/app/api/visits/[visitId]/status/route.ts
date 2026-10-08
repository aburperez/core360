import { authed, body } from "@/server/http/handler";
import { setVisitStatus } from "@/modules/visits/report.service";

/** Concluir (pede 10 fotos) ou reabrir a visita. */
export const PUT = authed<{ visitId: string }>(async ({ req, actor, params }) =>
  setVisitStatus(actor, params.visitId, await body(req)),
);
