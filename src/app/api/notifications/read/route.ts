import { authed, body } from "@/server/http/handler";
import { markRead } from "@/modules/notifications/notifications.service";

/** Marca avisos como lidos: { ids: [...] } ou, sem ids, todos. */
export const POST = authed(async ({ req, actor }) => markRead(actor, await body(req)));
