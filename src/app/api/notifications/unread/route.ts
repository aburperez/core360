import { authed } from "@/server/http/handler";
import { unreadCount } from "@/modules/notifications/notifications.service";

export const GET = authed(async ({ actor }) => ({ count: await unreadCount(actor) }));
