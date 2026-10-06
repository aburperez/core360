import { authed, body } from "@/server/http/handler";
import { claimOccurrence } from "@/modules/occurrences/occurrences.service";

export const POST = authed<{ occurrenceId: string }>(async ({ req, actor, params }) =>
  claimOccurrence(actor, params.occurrenceId, await body(req)),
);
