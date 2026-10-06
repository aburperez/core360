import { authed, query } from "@/server/http/handler";
import { listTeams } from "@/modules/teams/teams.service";

export const GET = authed<{ eventId: string }>(({ req, actor, params }) =>
  listTeams(actor, params.eventId, query(req).areaId),
);
