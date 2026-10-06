import { authed } from "@/server/http/handler";
import { getOccurrence } from "@/modules/occurrences/occurrences.service";

export const GET = authed<{ occurrenceId: string }>(({ actor, params }) => getOccurrence(actor, params.occurrenceId));
