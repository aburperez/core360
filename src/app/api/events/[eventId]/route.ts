import { authed, body } from "@/server/http/handler";
import { getEvent, updateEvent } from "@/modules/events/events.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => getEvent(actor, params.eventId));
/** Dados e fase do evento: Admin da agência ou Gerente. */
export const PATCH = authed<{ eventId: string }>(async ({ req, actor, params }) => updateEvent(actor, params.eventId, await body(req)));
