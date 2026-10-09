import { authed, body } from "@/server/http/handler";
import { closeEvent } from "@/modules/closure/closure.service";

/** Encerrar e excluir: { confirm: nome do evento, understood: true }. Não tem volta. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => closeEvent(actor, params.eventId, await body(req)));
