import { authed, body } from "@/server/http/handler";
import { getEventBriefing, saveEventBriefing } from "@/modules/events/briefing.service";

/** Briefing do evento (Pré-produção). */
export const GET = authed<{ eventId: string }>(async ({ actor, params }) => getEventBriefing(actor, params.eventId));

export const PUT = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  saveEventBriefing(actor, params.eventId, await body(req)),
);
