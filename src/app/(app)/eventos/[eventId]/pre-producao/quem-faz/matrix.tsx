"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { FormError } from "@/components/field";
import { api } from "@/components/api-client";
import { formatDuration } from "@/lib/format";

type Type = { id: string; name: string; slaMinutes: number | null; peopleIds: string[] };
type Person = { id: string; name: string; jobTitle: string | null };

/** Pessoas nas linhas, tipos nas colunas. O gestor marca; os outros só consultam. */
export function Matrix({ eventId, manage, types, people }: { eventId: string; manage: boolean; types: Type[]; people: Person[] }) {
  const [marks, setMarks] = useState(() => new Set(types.flatMap((t) => t.peopleIds.map((p) => `${t.id}:${p}`))));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(typeId: string, personId: string) {
    const key = `${typeId}:${personId}`;
    const does = !marks.has(key);
    setBusy(key);
    setError(null);
    try {
      await api(`/api/service-types/${typeId}/people`, { body: { participantId: personId, does } });
      setMarks((m) => {
        const next = new Set(m);
        if (does) next.add(key); else next.delete(key);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <FormError message={error} />
      <Card className="mt-2 overflow-x-auto p-0">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Pessoa</th>
              {types.map((t) => (
                <th key={t.id} className="max-w-40 px-3 py-3 text-center align-bottom font-semibold">
                  <Link href={`/eventos/${eventId}/pre-producao/tipos/${t.id}`} className="hover:text-primary">{t.name}</Link>
                  <span className="block text-xs font-normal text-muted">{t.slaMinutes ? `SLA ${formatDuration(t.slaMinutes * 60)}` : "sem SLA"}</span>
                </th>
              ))}
              <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {people.map((p) => {
              const total = types.filter((t) => marks.has(`${t.id}:${p.id}`)).length;
              return (
                <tr key={p.id} className="transition hover:bg-white/5">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2">
                    <span className="font-medium">{p.name}</span>
                    {p.jobTitle && <span className="block text-xs text-muted">{p.jobTitle}</span>}
                  </td>
                  {types.map((t) => {
                    const key = `${t.id}:${p.id}`;
                    const on = marks.has(key);
                    return (
                      <td key={t.id} className="px-3 py-2 text-center">
                        {manage ? (
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={busy === key}
                            onChange={() => toggle(t.id, p.id)}
                            aria-label={`${p.name} faz ${t.name}`}
                            className="h-6 w-6 cursor-pointer accent-[var(--brand-cyan)]"
                          />
                        ) : (
                          <span aria-label={on ? "faz" : "não faz"} className={on ? "text-lg text-primary" : "text-muted"}>{on ? "✓" : "·"}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {!manage && <p className="mt-2 px-1 text-sm text-muted">Só o gerente ou o head da área marca quem faz cada tipo.</p>}
    </>
  );
}
