import { authed } from "@/server/http/handler";
import { listBriefings } from "@/modules/briefings/briefings.service";

/** Pessoas do campo e a situação do briefing de cada uma (Pré-produção). */
export const GET = authed<{ eventId: string }>(({ actor, params }) => listBriefings(actor, params.eventId));
