import { authed } from "@/server/http/handler";
import { listNotifications } from "@/modules/notifications/notifications.service";

/** Meus avisos (os mais recentes) e quantos não li. */
export const GET = authed(async ({ actor }) => listNotifications(actor));
