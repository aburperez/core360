import { authed, body } from "@/server/http/handler";
import { closeEvent } from "@/modules/closure/closure.service";

/** Encerrar e apagar: { confirm: nome do evento, savedAllParts: true }. Não tem volta. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => closeEvent(actor, params.eventId, await body(req)));
