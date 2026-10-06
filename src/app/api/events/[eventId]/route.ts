import { authed } from "@/server/http/handler";
import { getEvent } from "@/modules/events/events.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => getEvent(actor, params.eventId));
