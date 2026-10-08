import { authed, body } from "@/server/http/handler";
import { deleteVisit, updateVisit } from "@/modules/visits/visits.service";

export const PATCH = authed<{ visitId: string }>(async ({ req, actor, params }) =>
  updateVisit(actor, params.visitId, await body(req)),
);

export const DELETE = authed<{ visitId: string }>(({ actor, params }) => deleteVisit(actor, params.visitId));
