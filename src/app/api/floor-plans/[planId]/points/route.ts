import { authed, body } from "@/server/http/handler";
import { createPoint } from "@/modules/floorplans/floorplans.service";

/** Nova etapa marcada nesta planta. */
export const POST = authed<{ planId: string }>(async ({ req, actor, params }) => createPoint(actor, params.planId, await body(req)), { status: 201 });
