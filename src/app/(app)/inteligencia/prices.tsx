import type { Actor } from "@/server/authz/actor";
import { priceBank } from "@/modules/intelligence/intelligence.service";
import { Input } from "@/components/field";
import { EmptyState } from "@/components/ui";
import { PriceList } from "@/components/price-list";
import { brl } from "@/lib/money";
import { CategorySelect, FilterForm, type HiddenValues } from "./shared";

/** O que a agência já pagou por cada item, em todos os eventos. */
export async function PricesTab({ actor, agencyId, q, category, hidden }: { actor: Actor; agencyId: string; q?: string; category?: string; hidden: HiddenValues }) {
  const r = await priceBank(actor, agencyId, { q, category });
  const s = r.unitStats;
  return (
    <>
      <p className="text-sm text-muted">
        Os preços dos itens de todos os eventos da agência, inclusive dos encerrados e excluídos (o resumo guarda os preços).
        Vale o realizado; sem realizado, o contratado.
      </p>
      <FilterForm hidden={hidden} submit="Buscar">
        <label className="block min-w-0 flex-[2_1_14rem]">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Item ou fornecedor</span>
          <Input name="q" type="search" defaultValue={r.q} placeholder="Ex.: palco, gerador, tenda" className="min-h-10 py-1.5" />
        </label>
        <CategorySelect value={r.category} />
      </FilterForm>

      {r.total === 0 ? (
        <EmptyState title={r.q || r.category ? "Nenhum preço encontrado" : "Nenhum preço ainda"}>
          {r.q || r.category
            ? "Tente outra palavra ou tire o filtro de categoria."
            : "Os preços aparecem quando o diretor preenche o contratado ou o realizado no Orçamento de um evento."}
        </EmptyState>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumo">
            <Fact label="Preços" value={String(r.total)} hint={`em ${r.events} ${r.events === 1 ? "evento" : "eventos"}`} />
            {s && (
              <>
                <Fact label="Menor por unidade" value={brl(s.min)} hint={s.unit ? `por ${s.unit}` : "por unidade"} />
                <Fact label="Média por unidade" value={brl(s.avg)} hint={`${s.n} ${s.n === 1 ? "item" : "itens"}`} />
                <Fact label="Maior por unidade" value={brl(s.max)} hint={s.unit ? `por ${s.unit}` : "por unidade"} />
              </>
            )}
          </section>
          <PriceList items={r.items} />
          <p className="text-xs text-muted">
            {r.total > r.items.length ? `Mostrando os ${r.items.length} mais recentes de ${r.total}; refine a busca. ` : ""}
            Opcionais e itens sem contratado nem realizado ficam fora. Valores dos fornecedores, sem honorários e encargos.
          </p>
        </>
      )}
    </>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums lg:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}
