import { authed, body } from "@/server/http/handler";
import { createVisit, listVisits } from "@/modules/visits/visits.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => listVisits(actor, params.eventId));

/** Nova visita técnica neste evento. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  createVisit(actor, params.eventId, await body(req)),
{ status: 201 });
