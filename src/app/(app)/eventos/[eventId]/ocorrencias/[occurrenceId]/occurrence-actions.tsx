"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { FormError, Label, Select } from "@/components/field";
import { PhotoPicker } from "@/components/photo-picker";
import { api, ApiError } from "@/components/api-client";
import { uploadPhoto } from "@/components/photo";

type Status = "PENDENTE" | "EM_ANDAMENTO" | "URGENTE" | "BLOQUEIO" | "CONCLUIDO" | "CANCELADO";

export function OccurrenceActions({
  occurrence: o,
  can,
  people,
}: {
  occurrence: { id: string; status: Status; version: number; responsibleParticipantId: string | null; priority: string };
  can: { work: boolean; manage: boolean; validate: boolean; conclude: boolean; claim: boolean };
  people: { id: string; name: string; teamName: string | null }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const closed = o.status === "CONCLUIDO" || o.status === "CANCELADO";

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setPhotos([]);
      router.refresh();
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 409 ? "Outra pessoa mudou este chamado agora. A tela foi atualizada; confira e tente de novo." : e.message);
      if (e.status === 409) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (status: Status) =>
    run(status, () => api(`/api/occurrences/${o.id}/status`, { body: { status, expectedVersion: o.version } }));

  const conclude = () =>
    run("CONCLUIR", async () => {
      for (const f of photos) await uploadPhoto(o.id, f, "CONCLUSAO");
      await api(`/api/occurrences/${o.id}/conclude`, { body: { expectedVersion: o.version } });
    });

  return (
    <div className="mt-4 space-y-3">
      <FormError message={error} />

      {can.claim && (
        <Button className="w-full text-lg" disabled={!!busy}
          onClick={() => run("CLAIM", () => api(`/api/occurrences/${o.id}/claim`, { body: { expectedVersion: o.version } }))}>
          {busy === "CLAIM" ? "Assumindo…" : "🙋 Assumir este chamado"}
        </Button>
      )}

      {can.conclude && (
        <Card className="space-y-3">
          <PhotoPicker files={photos} onChange={setPhotos} label="Foto da solução" />
          {/* CONCLUIR CHAMADO: some quando já está concluído (can.conclude = false). */}
          <Button variant="success" className="w-full text-lg" onClick={conclude} disabled={!!busy}>
            {busy === "CONCLUIR" ? "Concluindo…" : "✓ CONCLUIR CHAMADO"}
          </Button>
          <div className="grid grid-cols-3 gap-2">
            {o.status !== "EM_ANDAMENTO" && (
              <Button variant="secondary" onClick={() => setStatus("EM_ANDAMENTO")} disabled={!!busy}>Iniciar</Button>
            )}
            {o.status !== "BLOQUEIO" && (
              <Button variant="secondary" onClick={() => setStatus("BLOQUEIO")} disabled={!!busy}>Bloqueio</Button>
            )}
            {o.status !== "URGENTE" && (
              <Button variant="secondary" className="text-red-600 dark:text-red-400" onClick={() => setStatus("URGENTE")} disabled={!!busy}>Urgente</Button>
            )}
          </div>
        </Card>
      )}

      {!closed && !can.conclude && !can.claim && (
        <p className="px-1 text-sm text-muted">Só o responsável, o Head da área ou o Gerente podem atualizar este chamado.</p>
      )}

      {can.validate && (
        <Card className="space-y-2">
          <p className="font-medium">Validação do gestor</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="success" disabled={!!busy}
              onClick={() => run("APROVAR", () => api(`/api/occurrences/${o.id}/validate`, { body: { approved: true, expectedVersion: o.version } }))}>
              Aprovar
            </Button>
            <Button variant="secondary" disabled={!!busy}
              onClick={() => run("REPROVAR", () => api(`/api/occurrences/${o.id}/validate`, { body: { approved: false, expectedVersion: o.version } }))}>
              Reprovar e reabrir
            </Button>
          </div>
        </Card>
      )}

      {can.manage && !closed && (
        <Card className="space-y-3">
          <label className="block">
            <Label>Responsável</Label>
            <Select
              value={o.responsibleParticipantId ?? ""}
              disabled={!!busy}
              onChange={(e) =>
                run("ASSIGN", () =>
                  api(`/api/occurrences/${o.id}/assign`, {
                    body: { responsibleParticipantId: e.target.value || null, expectedVersion: o.version },
                  }),
                )
              }
            >
              <option value="">Sem responsável (equipe)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.teamName ? ` · ${p.teamName}` : ""}</option>
              ))}
            </Select>
          </label>
          <Button variant="ghost" className="w-full text-red-600" disabled={!!busy}
            onClick={() => { if (confirm("Cancelar este chamado?")) setStatus("CANCELADO"); }}>
            Cancelar chamado
          </Button>
        </Card>
      )}
    </div>
  );
}
