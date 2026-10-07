import { authed, body } from "@/server/http/handler";
import { setPersonFunction } from "@/modules/functions/functions.service";

/** Troca a função desta pessoa ({ functionId } ou null para tirar). */
export const PUT = authed<{ eventId: string; participantId: string }>(async ({ req, actor, params }) =>
  setPersonFunction(actor, params.eventId, params.participantId, await body(req)),
);
