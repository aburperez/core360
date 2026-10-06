import { authed, body } from "@/server/http/handler";
import { reassignOccurrence } from "@/modules/occurrences/occurrences.service";

export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) =>
  reassignOccurrence(actor, params.occurrenceId, await body(req)),
);
