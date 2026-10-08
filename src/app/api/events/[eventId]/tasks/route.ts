import { authed, body } from "@/server/http/handler";
import { createTask } from "@/modules/pendencies/pendencies.service";

/** Nova pendência manual: { title, dueOn?, areaId?, responsibleId? }. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => createTask(actor, params.eventId, await body(req)), { status: 201 });
