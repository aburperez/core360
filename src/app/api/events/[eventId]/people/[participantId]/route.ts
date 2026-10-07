import { authed } from "@/server/http/handler";
import { getPersonPlan } from "@/modules/functions/functions.service";

/** Pré-produção: dados, função, ficha e agenda de uma pessoa. */
export const GET = authed<{ eventId: string; participantId: string }>(({ actor, params }) =>
  getPersonPlan(actor, params.eventId, params.participantId),
);
