import { authed, body } from "@/server/http/handler";
import { deleteActivity, updateActivity } from "@/modules/functions/functions.service";

export const PATCH = authed<{ activityId: string }>(async ({ req, actor, params }) =>
  updateActivity(actor, params.activityId, await body(req)),
);
export const DELETE = authed<{ activityId: string }>(({ actor, params }) => deleteActivity(actor, params.activityId));
