import type { Actor } from "@/server/authz/actor";
import { supplierRanking } from "@/modules/intelligence/intelligence.service";
import { RATING_CRITERIA, ratingText } from "@/modules/suppliers/rating-meta";
import { Panel } from "@/components/panel";
import { RatingBadge } from "@/components/rating";
import { EmptyState, cx } from "@/components/ui";
import { CategorySelect, FilterForm, categoryLabel, type HiddenValues } from "./shared";

const score = (n: number) => (n >= 8 ? "text-emerald-300" : n >= 6 ? "text-sky-200" : "text-amber-200");

/** Ranking dos fornecedores pela nota média de todos os eventos da agência. */
export async function RankingTab({ actor, agencyId, category, hidden }: { actor: Actor; agencyId: string; category?: string; hidden: HiddenValues }) {
  const r = await supplierRanking(actor, agencyId, { category });
  return (
    <>
      <p className="text-sm text-muted">
        A nota de cada fornecedor é a média das avaliações do diretor e dos Heads no Fechamento de cada evento (0 a 10, em 6 critérios).
        Quem ainda não foi avaliado não entra.
      </p>
      <FilterForm hidden={hidden}>
        <CategorySelect value={r.category} />
      </FilterForm>

      {!r.category && r.byCategory.length > 0 && (
        <Panel title="Os melhores de cada categoria">
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {r.byCategory.map((g) => (
              <li key={g.category} className="rounded-xl border border-border bg-black/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{categoryLabel(g.category)}</p>
                <ol className="mt-2 space-y-1.5">
                  {g.top.map((s, k) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate"><span className="mr-1.5 text-muted tabular-nums">{k + 1}º</span>{s.name}</span>
                      <RatingBadge value={s.rating.overall} />
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {r.items.length === 0 ? (
        <EmptyState title={r.category ? `Nenhum fornecedor de ${categoryLabel(r.category)} avaliado ainda` : "Nenhum fornecedor avaliado ainda"}>
          As notas aparecem quando o diretor e os Heads avaliam os fornecedores na etapa Fechamento de um evento.
        </EmptyState>
      ) : (
        <section className="rounded-2xl border border-border bg-surface" aria-label="Ranking">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted">
            {r.category ? `Ranking de ${categoryLabel(r.category)}` : "Ranking geral"} ({r.items.length})
          </h2>
          {/* Tela larga: tabela com os 6 critérios. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 font-semibold">#</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Fornecedor</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Nota</th>
                  {RATING_CRITERIA.map((c) => <th key={c.key} scope="col" className="px-2 py-2 text-right font-semibold">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.items.map((s, k) => (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2.5 font-bold tabular-nums text-muted">{k + 1}º</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted">{[s.categories.map(categoryLabel).join(", "), s.place].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-3 py-2.5"><RatingBadge value={s.rating.overall} count={s.rating.ratings} /></td>
                    {RATING_CRITERIA.map((c) => (
                      <td key={c.key} className={cx("px-2 py-2.5 text-right font-semibold tabular-nums", score(s.rating[c.key]))}>{ratingText(s.rating[c.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Celular: cartões. */}
          <ol className="divide-y divide-border lg:hidden">
            {r.items.map((s, k) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-medium"><span className="mr-1.5 font-bold text-muted tabular-nums">{k + 1}º</span>{s.name}</p>
                  <RatingBadge value={s.rating.overall} count={s.rating.ratings} />
                </div>
                {s.categories.length > 0 && <p className="mt-0.5 text-xs text-muted">{s.categories.map(categoryLabel).join(", ")}</p>}
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {RATING_CRITERIA.map((c) => (
                    <span key={c.key}><span className="text-muted">{c.label}</span> <b className={cx("tabular-nums", score(s.rating[c.key]))}>{ratingText(s.rating[c.key])}</b></span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {r.unrated > 0 && (
        <p className="text-xs text-muted">
          {r.unrated} {r.unrated === 1 ? "fornecedor do cadastro ainda não foi avaliado" : "fornecedores do cadastro ainda não foram avaliados"} e {r.unrated === 1 ? "fica" : "ficam"} fora do ranking.
        </p>
      )}
    </>
  );
}
