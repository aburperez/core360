import { authed } from "@/server/http/handler";
import { listPendencies } from "@/modules/pendencies/pendencies.service";

/** Central de pendências do evento (Pré-produção). Filtros: ?areaId=&responsibleId= */
export const GET = authed<{ eventId: string }>(({ req, actor, params }) => {
  const q = new URL(req.url).searchParams;
  return listPendencies(actor, params.eventId, { areaId: q.get("areaId") || undefined, responsibleId: q.get("responsibleId") || undefined });
});
