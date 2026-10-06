import { authed, body } from "@/server/http/handler";
import { updateDirector } from "@/modules/directors/directors.service";

export const PATCH = authed<{ directorId: string }>(async ({ req, actor, params }) =>
  updateDirector(actor, params.directorId, await body(req)),
);
