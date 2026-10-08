import { authed } from "@/server/http/handler";
import { createDefaultMilestones } from "@/modules/schedule/schedule.service";

/** Cria os marcos padrão (T-30 a T0) num evento que ainda não tem marcos. */
export const POST = authed<{ eventId: string }>(({ actor, params }) => createDefaultMilestones(actor, params.eventId));
