import { authed, body } from "@/server/http/handler";
import { savePersonProfile } from "@/modules/functions/functions.service";

/** A Pré-produção preenche a ficha por esta pessoa. */
export const PUT = authed<{ eventId: string; participantId: string }>(async ({ req, actor, params }) =>
  savePersonProfile(actor, params.eventId, params.participantId, await body(req)),
);
