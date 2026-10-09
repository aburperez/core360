"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api-client";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { Button, Card, cx } from "@/components/ui";
import { ARRIVAL_STATUS, NEXT_STEP, previousStatus, type ArrivalStatus } from "@/modules/arrivals/arrival-meta";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** O próximo passo (botão grande) e voltar um passo. */
export function StatusButtons({ id, status, supplier }: { id: string; status: ArrivalStatus; supplier: string }) {
  const { busy, error, run } = useAction();
  const next = NEXT_STEP[status];
  const back = previousStatus(status);
  const go = (to: ArrivalStatus) => run(() => api(`/api/arrivals/${id}/status`, { body: { status: to } }));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {next && (
        <Button disabled={busy} className="min-h-11 px-4 text-sm" onClick={() => go(next.to)} aria-label={`${next.label}: ${supplier}`}>
          {next.label}
        </Button>
      )}
      {back && (
        <Button
          variant="ghost" disabled={busy} className="min-h-9 px-2 text-xs text-muted"
          onClick={() => { if (confirm(`Voltar "${supplier}" para ${ARRIVAL_STATUS[back].label}?`)) go(back); }}
        >
          Voltar para {ARRIVAL_STATUS[back].label}
        </Button>
      )}
      <FormError message={error} />
    </div>
  );
}

type Option = { id: string; name: string };
export type ArrivalInitial = {
  id?: string; supplierName: string; scheduledAt: string; endsAt: string; vehicle: string; plate: string; driver: string;
  driverPhone: string; dock: string; areaId: string; responsibleId: string; notes: string; itemIds: string[];
};
const EMPTY: ArrivalInitial = { supplierName: "", scheduledAt: "", endsAt: "", vehicle: "", plate: "", driver: "", driverPhone: "", dock: "", areaId: "", responsibleId: "", notes: "", itemIds: [] };

/** Nova chegada ou mudar uma (Pré-produção). */
export function ArrivalDialog({ eventId, initial, areas, people, costItems }: {
  eventId: string; initial?: ArrivalInitial; areas: Option[]; people: Option[]; costItems: Option[];
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  const v = initial ?? EMPTY;
  const editing = !!initial?.id;
  const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;
  return (
    <>
      {editing
        ? <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setOpen(true)}>Mudar</Button>
        : <Button className="min-h-10 px-3 text-sm" onClick={() => setOpen(true)}>+ Nova chegada</Button>}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" role="dialog" aria-label={editing ? "Mudar chegada" : "Nova chegada"}>
          <Card className="my-auto w-full max-w-2xl">
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const body = {
                  supplierName: String(f.get("supplierName") ?? ""),
                  scheduledAt: str(f, "scheduledAt"), endsAt: str(f, "endsAt"),
                  vehicle: str(f, "vehicle"), plate: str(f, "plate"), driver: str(f, "driver"), driverPhone: str(f, "driverPhone"),
                  dock: str(f, "dock"), areaId: str(f, "areaId"), responsibleId: str(f, "responsibleId"), notes: str(f, "notes"),
                  itemIds: f.getAll("itemIds").map(String),
                };
                const ok = await run(() => editing
                  ? api(`/api/arrivals/${initial!.id}`, { method: "PATCH", body })
                  : api(`/api/events/${eventId}/arrivals`, { body }));
                if (ok) setOpen(false);
              }}
            >
              <p className="font-semibold">{editing ? "Mudar a chegada" : "Nova chegada"}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2"><Label>Fornecedor</Label><Input name="supplierName" required maxLength={160} defaultValue={v.supplierName} /></label>
                <label className="block"><Label hint="(opcional)">Chegada</Label><Input name="scheduledAt" type="datetime-local" defaultValue={v.scheduledAt} /></label>
                <label className="block"><Label hint="(opcional)">Montagem até</Label><Input name="endsAt" type="datetime-local" defaultValue={v.endsAt} /></label>
                <label className="block"><Label hint="(opcional)">Veículo</Label><Input name="vehicle" maxLength={80} defaultValue={v.vehicle} placeholder="Ex.: caminhão baú 3/4" /></label>
                <label className="block"><Label hint="(opcional)">Placa</Label><Input name="plate" maxLength={20} defaultValue={v.plate} placeholder="ABC1D23" /></label>
                <label className="block"><Label hint="(opcional)">Motorista</Label><Input name="driver" maxLength={120} defaultValue={v.driver} /></label>
                <label className="block"><Label hint="(opcional)">Telefone do motorista</Label><Input name="driverPhone" maxLength={30} defaultValue={v.driverPhone} inputMode="tel" /></label>
                <label className="block"><Label hint="(opcional)">Doca ou portão</Label><Input name="dock" maxLength={80} defaultValue={v.dock} placeholder="Ex.: Portão 3" /></label>
                <label className="block">
                  <Label hint="(opcional)">Área</Label>
                  <Select name="areaId" defaultValue={v.areaId}>
                    <option value="">Sem área</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </label>
                <label className="block sm:col-span-2">
                  <Label hint="(opcional, alguém do campo)">Responsável</Label>
                  <Select name="responsibleId" defaultValue={v.responsibleId}>
                    <option value="">Sem responsável</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </label>
              </div>
              {costItems.length > 0 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">Itens que chegam <span className="text-muted">(opcional)</span></legend>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                    {costItems.map((i) => (
                      <label key={i.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="itemIds" value={i.id} defaultChecked={v.itemIds.includes(i.id)} className="h-4 w-4 accent-[var(--color-primary)]" />
                        {i.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="block"><Label hint="(opcional)">Observação</Label><Textarea name="notes" rows={2} maxLength={1000} defaultValue={v.notes} /></label>
              <FormError message={error} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy} className="min-h-10 px-3 text-sm">{editing ? "Salvar" : "Criar chegada"}</Button>
                <Button type="button" variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setOpen(false)}>Voltar</Button>
                {editing && (
                  <Button
                    type="button" variant="ghost" disabled={busy} className={cx("ml-auto min-h-10 px-3 text-sm text-red-300")}
                    onClick={() => { if (confirm(`Apagar a chegada de "${v.supplierName}"?`)) run(() => api(`/api/arrivals/${initial!.id}`, { method: "DELETE" })); }}
                  >
                    Apagar
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
