import { authed, body } from "@/server/http/handler";
import { setTaskDone } from "@/modules/pendencies/pendencies.service";

/** Feita ou não: { done }. */
export const POST = authed<{ taskId: string }>(async ({ req, actor, params }) => setTaskDone(actor, params.taskId, await body(req)));
