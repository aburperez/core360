import { authed, body } from "@/server/http/handler";
import { saveMyProfile } from "@/modules/functions/functions.service";

/** Minha ficha: a própria pessoa preenche. */
export const PUT = authed<{ eventId: string }>(async ({ req, actor, params }) =>
  saveMyProfile(actor, params.eventId, await body(req)),
);
