import { authed } from "@/server/http/handler";
import { distributeItemsByArea } from "@/modules/items/items.service";

/** Põe cada item sem área na área da categoria dele (só o gestor). */
export const POST = authed<{ eventId: string }>(({ actor, params }) => distributeItemsByArea(actor, params.eventId));
