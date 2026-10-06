import { authed, body } from "@/server/http/handler";
import { validateOccurrence } from "@/modules/occurrences/occurrences.service";

export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) =>
  validateOccurrence(actor, params.occurrenceId, await body(req)),
);
