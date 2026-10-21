"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { api } from "@/components/api-client";

/** Põe os itens sem área na área da categoria deles, de uma vez (só o gestor). */
export function DistributeAreas({ eventId, count }: { eventId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm">
      <p>
        <b>{count} {count === 1 ? "item sem área" : "itens sem área"}.</b> Cada pré-produtor ligado a uma área vê só os itens dela.
        {msg && <span className="block text-muted">{msg}</span>}
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ assigned: number; left: number }>(`/api/events/${eventId}/costs/distribute-areas`, { body: {} });
            setMsg(`${r.assigned} ${r.assigned === 1 ? "item foi" : "itens foram"} para a área da categoria${r.left ? `; ${r.left} sem área parecida ficam do evento todo` : ""}.`);
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          }
          setBusy(false);
        }}
      >
        Distribuir pelas áreas
      </Button>
    </div>
  );
}
