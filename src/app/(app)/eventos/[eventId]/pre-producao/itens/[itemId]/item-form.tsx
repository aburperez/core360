"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api-client";
import { Button } from "@/components/ui";
import { FormError, Input, Label, Select, Textarea } from "@/components/field";
import { decimal } from "@/lib/money";
import type { MapItem } from "@/modules/items/items.service";
import {
  CATEGORY, COMMON_UNITS, COST_CENTER_LABEL, COST_CENTERS, ITEM_CATEGORIES, ITEM_STATUS_LABEL, ITEM_STATUSES,
  type ItemCategory, type ItemStatus,
} from "@/modules/items/item-meta";

type Option = { id: string; name: string };

/** Edita os dados de produção do item. Centro de custo e alguns status só o diretor. */
export function ItemForm({ item, areas, people, others, can }: {
  item: MapItem; areas: Option[]; people: Option[]; others: Option[];
  can: { director: boolean; costCenter: boolean; statuses: ItemStatus[] };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ItemCategory | "">(item.category ?? "");
  const blocked = ITEM_STATUSES.filter((s) => !can.statuses.includes(s));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => {
      const v = String(f.get(k) ?? "").trim();
      return v || null;
    };
    const body: Record<string, unknown> = {
      areaId: get("areaId"), category: get("category"), quantity: get("quantity") ?? "0", unit: get("unit"),
      responsibleId: get("responsibleId"), neededOn: get("neededOn"), dependsOnId: get("dependsOnId"), location: get("location"), notes: get("notes"),
      status: get("status"),
    };
    if (can.costCenter) body.costCenter = get("costCenter");
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/cost-items/${item.id}`, { method: "PATCH", body });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
    } finally {
      setBusy(false);
    }
  }

  const defaultCenter = category ? COST_CENTER_LABEL[CATEGORY[category].center] : null;

  return (
    <form onSubmit={submit} className="space-y-3" onChange={() => setSaved(false)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Status</Label>
          <Select name="status" defaultValue={item.status}>
            {can.statuses.map((s) => <option key={s} value={s}>{ITEM_STATUS_LABEL[s]}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label>Área</Label>
          <Select name="areaId" defaultValue={item.areaId ?? ""}>
            <option value="">Sem área</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label>Categoria</Label>
          <Select name="category" value={category} onChange={(e) => setCategory(e.target.value as ItemCategory | "")}>
            <option value="">Sem categoria</option>
            {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label hint={can.costCenter ? undefined : "(só o diretor muda)"}>Centro de custo</Label>
          {can.costCenter ? (
            <Select name="costCenter" defaultValue={item.costCenterChosen ?? ""}>
              <option value="">{defaultCenter ? `Da categoria: ${defaultCenter}` : "Da categoria"}</option>
              {COST_CENTERS.map((c) => <option key={c} value={c}>{COST_CENTER_LABEL[c]}</option>)}
            </Select>
          ) : (
            <Input value={item.costCenterChosen ? COST_CENTER_LABEL[item.costCenterChosen] : (defaultCenter ?? "—")} disabled readOnly />
          )}
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <label className="block">
            <Label>Quantidade</Label>
            <Input name="quantity" inputMode="decimal" defaultValue={decimal(item.quantity)} required />
          </label>
          <label className="block">
            <Label hint="(opcional)">Unidade</Label>
            <Input name="unit" list="item-units" defaultValue={item.unit ?? ""} maxLength={20} placeholder="UN" />
            <datalist id="item-units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </label>
        </div>
        <label className="block">
          <Label>Responsável</Label>
          <Select name="responsibleId" defaultValue={item.responsibleId ?? ""}>
            <option value="">Sem responsável</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label hint="(data de necessidade, opcional)">Prazo</Label>
          <Input name="neededOn" type="date" defaultValue={item.neededOn ?? ""} />
        </label>
        <label className="block">
          <Label hint="(opcional)">Depende de</Label>
          <Select name="dependsOnId" defaultValue={item.dependsOnId ?? ""}>
            <option value="">Não depende de outro item</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <Label hint="(opcional)">Local</Label>
          <Input name="location" defaultValue={item.location ?? ""} maxLength={200} placeholder="Palco" />
        </label>
      </div>
      <label className="block">
        <Label hint="(opcional)">Observação</Label>
        <Textarea name="notes" rows={3} defaultValue={item.notes ?? ""} maxLength={2000} placeholder="Necessário backup" />
      </label>
      {!can.director && blocked.length > 0 && (
        <p className="text-xs text-muted">
          {blocked.map((s) => ITEM_STATUS_LABEL[s]).join(", ")}: só o diretor de produção ou o campo põem o item nesses status.
        </p>
      )}
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</Button>
        {saved && <span className="text-sm text-emerald-300" role="status">Salvo</span>}
      </div>
    </form>
  );
}
