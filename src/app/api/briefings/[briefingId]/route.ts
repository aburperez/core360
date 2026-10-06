import { authed } from "@/server/http/handler";
import { deleteBriefing } from "@/modules/briefings/briefings.service";

export const DELETE = authed<{ briefingId: string }>(({ actor, params }) => deleteBriefing(actor, params.briefingId));
