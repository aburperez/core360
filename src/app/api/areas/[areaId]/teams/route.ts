import { authed, body } from "@/server/http/handler";
import { createTeam } from "@/modules/teams/teams.service";

export const POST = authed<{ areaId: string }>(
  async ({ req, actor, params }) => createTeam(actor, { ...(await body(req) as object), areaId: params.areaId }),
  { status: 201 },
);
