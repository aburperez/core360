import { authed, body } from "@/server/http/handler";
import { deleteMilestone, updateMilestone } from "@/modules/schedule/schedule.service";

/** Muda nome, data ou responsável do marco. */
export const PATCH = authed<{ milestoneId: string }>(async ({ req, actor, params }) => updateMilestone(actor, params.milestoneId, await body(req)));

export const DELETE = authed<{ milestoneId: string }>(({ actor, params }) => deleteMilestone(actor, params.milestoneId));
