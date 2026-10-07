import { authed, body } from "@/server/http/handler";
import { deletePlan, renamePlan } from "@/modules/floorplans/floorplans.service";

export const PATCH = authed<{ planId: string }>(async ({ req, actor, params }) => renamePlan(actor, params.planId, await body(req)));

export const DELETE = authed<{ planId: string }>(({ actor, params }) => deletePlan(actor, params.planId));
