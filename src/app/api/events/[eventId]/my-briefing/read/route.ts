import { authed } from "@/server/http/handler";
import { markBriefingRead } from "@/modules/briefings/briefings.service";

/** "Li e entendi": a pessoa confirma que leu o próprio briefing. */
export const POST = authed<{ eventId: string }>(({ actor, params }) => markBriefingRead(actor, params.eventId));
