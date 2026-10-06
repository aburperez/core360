import { authed, body } from "@/server/http/handler";
import { changeStatus } from "@/modules/occurrences/occurrences.service";

export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) =>
  changeStatus(actor, params.occurrenceId, await body(req)),
);
