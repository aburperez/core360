import { authed } from "@/server/http/handler";
import { unreadCount } from "@/modules/notifications/notifications.service";
import { scheduleDispatchFromActivity } from "@/server/notify/kick";

export const GET = authed(async ({ actor }) => {
  scheduleDispatchFromActivity();
  return { count: await unreadCount(actor) };
});
