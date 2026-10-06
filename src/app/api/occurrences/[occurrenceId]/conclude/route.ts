import { authed, body } from "@/server/http/handler";
import { concludeOccurrence } from "@/modules/occurrences/occurrences.service";

export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) =>
  concludeOccurrence(actor, params.occurrenceId, await body(req)),
);
