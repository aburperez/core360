import { authed } from "@/server/http/handler";
import { createInvitation } from "@/modules/participants/participants.service";

export const POST = authed<{ participantId: string }>(
  ({ actor, params }) => createInvitation(actor, params.participantId),
  { status: 201 },
);
