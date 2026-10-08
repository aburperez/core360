import { authed, body } from "@/server/http/handler";
import { setMilestoneDone } from "@/modules/schedule/schedule.service";

/** Feito ou não: { done }. */
export const POST = authed<{ milestoneId: string }>(async ({ req, actor, params }) => setMilestoneDone(actor, params.milestoneId, await body(req)));
