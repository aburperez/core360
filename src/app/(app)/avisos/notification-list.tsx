"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { Button, Card, EmptyState, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

interface Item {
  id: string;
  type: string;
  title: string;
  body: string | null;
  occurrenceId: string | null;
  eventName: string | null;
  read: boolean;
  createdAt: string;
}

const TONE: Record<string, string> = {
  URGENTE: "bg-red-600",
  LEMBRETE: "bg-red-600",
  SLA_ESTOURADO: "bg-red-600",
  BLOQUEIO: "bg-amber-500",
  SLA_PROXIMO: "bg-amber-500",
  REPROVADA: "bg-amber-500",
};

export function NotificationList({ items, unread }: { items: Item[]; unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function open(n: Item) {
    if (!n.read) api("/api/notifications/read", { body: { ids: [n.id] } }).catch(() => {});
    if (n.occurrenceId) router.push(`/c/${n.occurrenceId}`);
    else router.refresh();
  }

  async function readAll() {
    setBusy(true);
    await api("/api/notifications/read", { body: {} }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  if (items.length === 0) {
    return <EmptyState title="Nenhum aviso por enquanto">Chamados urgentes, atribuídos a você e prazos de SLA aparecem aqui.</EmptyState>;
  }

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={readAll} disabled={busy} className="min-h-10 px-4 text-sm">
            Marcar todos como lidos
          </Button>
        </div>
      )}
      <Card className="divide-y divide-border p-0">
        {items.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => open(n)}
            className={cx("flex w-full items-start gap-3 px-4 py-3 text-left active:bg-background", n.read && "opacity-60")}
          >
            <span className={cx("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", n.read ? "bg-transparent" : (TONE[n.type] ?? "bg-primary"))} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className={cx("block", !n.read && "font-semibold")}>{n.title}</span>
              {n.body && <span className="block text-sm text-muted">{n.body}</span>}
              <span className="block text-xs text-muted">
                {formatDateTime(n.createdAt)}{n.eventName ? ` · ${n.eventName}` : ""}
                {!n.read && <span className="sr-only"> · não lido</span>}
              </span>
            </span>
          </button>
        ))}
      </Card>
    </div>
  );
}
