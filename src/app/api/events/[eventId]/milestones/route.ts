import { authed, body } from "@/server/http/handler";
import { createMilestone, getSchedule } from "@/modules/schedule/schedule.service";

/** Cronograma do evento: marcos e itens com prazo (Pré-produção). */
export const GET = authed<{ eventId: string }>(({ actor, params }) => getSchedule(actor, params.eventId));

/** Novo marco: { title, dueOn, responsibleId? }. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => createMilestone(actor, params.eventId, await body(req)), { status: 201 });
