import { authed, body, query } from "@/server/http/handler";
import { createParticipant, listParticipants } from "@/modules/participants/participants.service";

export const GET = authed<{ eventId: string }>(({ req, actor, params }) => {
  const q = query(req);
  return listParticipants(actor, params.eventId, { areaId: q.areaId, teamId: q.teamId, includeInactive: q.includeInactive === "true" });
});
export const POST = authed<{ eventId: string }>(
  async ({ req, actor, params }) => createParticipant(actor, { ...(await body(req) as object), eventId: params.eventId }),
  { status: 201 },
);
