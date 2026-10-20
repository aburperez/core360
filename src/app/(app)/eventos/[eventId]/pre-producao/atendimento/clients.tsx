"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { FormError } from "@/components/field";
import { ClientViewSwitches, type ClientView } from "../../equipe/access-switches";

const NO_VIEW: ClientView = { costs: false, team: false, progress: false };

/** Um cartão por Cliente, com as chaves do que ele vê. */
export function ClientCards({ clients, views }: {
  clients: { id: string; name: string; email: string; company: string | null; joined: boolean }[];
  views: Record<string, ClientView>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return (
    <div className="space-y-3">
      <FormError message={error} />
      {clients.map((c) => (
        <Card key={c.id}>
          <p className="font-semibold">{c.name}</p>
          <p className="text-sm text-muted">{[c.company, c.email].filter(Boolean).join(" · ")}{c.joined ? "" : " · ainda sem acesso"}</p>
          <ClientViewSwitches participantId={c.id} view={views[c.id] ?? NO_VIEW} guard={guard} />
        </Card>
      ))}
    </div>
  );
}
