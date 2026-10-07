import { authed, body } from "@/server/http/handler";
import { deletePoint, updatePoint } from "@/modules/floorplans/floorplans.service";

export const PATCH = authed<{ pointId: string }>(async ({ req, actor, params }) => updatePoint(actor, params.pointId, await body(req)));

export const DELETE = authed<{ pointId: string }>(({ actor, params }) => deletePoint(actor, params.pointId));
