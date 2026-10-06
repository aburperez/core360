import { authed, body } from "@/server/http/handler";
import { saveDailyNote } from "@/modules/reports/reports.service";

/** Observações do gestor sobre o dia (texto vazio apaga). */
export const PUT = authed<{ eventId: string; day: string }>(async ({ req, actor, params }) =>
  saveDailyNote(actor, params.eventId, params.day, await body(req)),
);
