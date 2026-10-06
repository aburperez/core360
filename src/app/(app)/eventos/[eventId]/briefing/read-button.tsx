"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FormError } from "@/components/field";
import { api } from "@/components/api-client";

/** "Li e entendi": confirma a leitura da versão atual do briefing. */
export function ReadButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        className="w-full lg:w-auto"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/events/${eventId}/my-briefing/read`, { body: {} });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Salvando…" : "Li e entendi"}
      </Button>
      <div className="mt-2"><FormError message={error} /></div>
    </>
  );
}
