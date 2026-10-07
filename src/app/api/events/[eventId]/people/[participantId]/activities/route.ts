import { authed, body } from "@/server/http/handler";
import { addPersonActivity } from "@/modules/functions/functions.service";

/** Atividade só desta pessoa. */
export const POST = authed<{ eventId: string; participantId: string }>(
  async ({ req, actor, params }) => addPersonActivity(actor, params.eventId, params.participantId, await body(req)),
  { status: 201 },
);
