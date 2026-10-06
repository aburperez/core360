import { authed, body } from "@/server/http/handler";
import { applyBriefingToTeam } from "@/modules/briefings/briefings.service";

/** O mesmo briefing para todos da equipe (substitui o que já havia). */
export const PUT = authed<{ teamId: string }>(async ({ req, actor, params }) =>
  applyBriefingToTeam(actor, params.teamId, await body(req)),
);
