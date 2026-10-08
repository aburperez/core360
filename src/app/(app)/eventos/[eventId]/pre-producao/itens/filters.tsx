"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/field";
import { CATEGORY, ITEM_CATEGORIES, ITEM_STATUS_LABEL, ITEM_STATUSES } from "@/modules/items/item-meta";

type Option = { id: string; name: string };

/** Filtros do Mapa de itens: cada escolha muda a URL (dá para salvar e mandar o link). */
export function ItemFilters({ areas, people }: { areas: Option[]; people: Option[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  };
  const select = (key: string, label: string, options: { value: string; label: string }[]) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <Select aria-label={label} className="min-h-10 py-1.5" value={params.get(key) ?? ""} onChange={(e) => set(key, e.target.value)}>
        <option value="">Todas</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {select("area", "Área", [...areas.map((a) => ({ value: a.id, label: a.name })), { value: "none", label: "Sem área" }])}
      {select("status", "Status", ITEM_STATUSES.map((s) => ({ value: s, label: ITEM_STATUS_LABEL[s] })))}
      {select("responsavel", "Responsável", [...people.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "Sem responsável" }])}
      {select("categoria", "Categoria", [...ITEM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY[c].label })), { value: "none", label: "Sem categoria" }])}
    </div>
  );
}
