import { authed, body } from "@/server/http/handler";
import { setActivityDone } from "@/modules/functions/functions.service";

/** Marca ({ done: true }) ou desmarca uma atividade da minha agenda. */
export const PUT = authed<{ eventId: string; activityId: string }>(async ({ req, actor, params }) =>
  setActivityDone(actor, params.eventId, params.activityId, await body(req)),
);
