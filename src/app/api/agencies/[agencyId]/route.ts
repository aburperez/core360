import { authed, body } from "@/server/http/handler";
import { getAgency, updateAgency } from "@/modules/agencies/agencies.service";

export const GET = authed<{ agencyId: string }>(({ actor, params }) => getAgency(actor, params.agencyId));
/** Renomear, suspender ou reativar: só o Admin da plataforma. */
export const PATCH = authed<{ agencyId: string }>(async ({ req, actor, params }) => updateAgency(actor, params.agencyId, await body(req)));
