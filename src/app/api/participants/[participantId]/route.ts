import { authed, body } from "@/server/http/handler";
import { updateParticipant } from "@/modules/participants/participants.service";

export const PATCH = authed<{ participantId: string }>(async ({ req, actor, params }) =>
  updateParticipant(actor, params.participantId, await body(req)),
);
