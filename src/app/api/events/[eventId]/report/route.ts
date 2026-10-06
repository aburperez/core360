import { authed, query } from "@/server/http/handler";
import { getDailyReport } from "@/modules/reports/reports.service";

/** Relatório diário (?dia=AAAA-MM-DD; sem dia, o mais perto de hoje). */
export const GET = authed<{ eventId: string }>(({ req, actor, params }) => getDailyReport(actor, params.eventId, query(req).dia));
