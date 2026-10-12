import type { ReactNode } from "react";
import { Select } from "@/components/field";
import { CATEGORY, ITEM_CATEGORIES, type ItemCategory } from "@/modules/items/item-meta";

export type HiddenValues = Record<string, string>;

/** Filtro sem JavaScript: um formulário GET que mantém a aba e a agência. */
export function FilterForm({ hidden, children, submit = "Filtrar" }: { hidden: HiddenValues; children: ReactNode; submit?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button type="submit" className="min-h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{submit}</button>
    </form>
  );
}

export function CategorySelect({ value, all = "Todas" }: { value: string | null; all?: string }) {
  return (
    <label className="block min-w-44 flex-1 sm:flex-none">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Categoria</span>
      <Select name="categoria" defaultValue={value ?? ""} className="min-h-10 py-1.5">
        <option value="">{all}</option>
        {ITEM_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
      </Select>
    </label>
  );
}

export const categoryLabel = (c: ItemCategory | null | "") => (c ? CATEGORY[c].label : "Sem categoria");
