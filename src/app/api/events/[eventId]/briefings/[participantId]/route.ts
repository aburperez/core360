import { authed, body } from "@/server/http/handler";
import { getBriefingFor, saveBriefing } from "@/modules/briefings/briefings.service";

export const GET = authed<{ eventId: string; participantId: string }>(({ actor, params }) =>
  getBriefingFor(actor, params.eventId, params.participantId),
);

/** Escreve ou reescreve o briefing desta pessoa. */
export const PUT = authed<{ eventId: string; participantId: string }>(async ({ req, actor, params }) =>
  saveBriefing(actor, params.eventId, params.participantId, await body(req)),
);
