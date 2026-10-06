import { requireUser } from "@/server/http/session";
import { getWhatsappSettings, listNotifications } from "@/modules/notifications/notifications.service";
import { TopBar } from "@/components/top-bar";
import { NotificationList } from "./notification-list";
import { WhatsappSettings } from "./whatsapp-settings";

export const metadata = { title: "Avisos" };

export default async function NotificationsPage() {
  const actor = await requireUser();
  const [{ items, unread }, whatsapp] = await Promise.all([listNotifications(actor), getWhatsappSettings(actor)]);
  return (
    <>
      <TopBar title="Avisos" subtitle={unread ? `${unread} não lidos` : "Tudo lido"} back="/eventos" />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <NotificationList
          unread={unread}
          items={items.map((n) => ({
            id: n.id, type: n.type, title: n.title, body: n.body, occurrenceId: n.occurrenceId,
            eventName: n.event?.name ?? null, read: !!n.readAt, createdAt: n.createdAt.toISOString(),
          }))}
        />
        <WhatsappSettings initial={whatsapp} />
      </main>
    </>
  );
}
