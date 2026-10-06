import { authed, body } from "@/server/http/handler";
import { createEvent, listEvents } from "@/modules/events/events.service";

export const GET = authed(({ actor }) => listEvents(actor));
export const POST = authed(async ({ req, actor }) => createEvent(actor, await body(req)), { status: 201 });
