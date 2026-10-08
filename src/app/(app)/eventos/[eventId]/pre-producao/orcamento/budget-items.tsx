"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/api-client";
import { Button, cx } from "@/components/ui";
import { FormError, Input, Label } from "@/components/field";
import { brl, decimal } from "@/lib/money";
import type { getBudget } from "@/modules/items/budget.service";

type Item = Awaited<ReturnType<typeof getBudget>>["items"][number];

const money = (v: number | null) => (v === null ? "—" : brl(v));

/** Diferença com sinal e cor: verde quando é bom para o orçamento. */
function Diff({ value, goodWhenPositive }: { value: number | null; goodWhenPositive: boolean }) {
  if (value === null || value === 0) return <span className="text-muted">{value === 0 ? brl(0) : "—"}</span>;
  const good = goodWhenPositive ? value > 0 : value < 0;
  return <span className={good ? "text-emerald-300" : "text-red-300"}>{value > 0 ? "+" : "−"}{brl(Math.abs(value))}</span>;
}

/** Itens com os 4 valores. Cotado digita a Pré-produção (sem cotação); Contratado e Realizado, o diretor. */
export function BudgetItems({ items, eventId, director }: { items: Item[]; eventId: string; director: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const itemHref = (id: string) => `/eventos/${eventId}/pre-producao/itens/${id}`;
  return (
    <section className="rounded-2xl border border-border bg-surface" aria-label="Itens">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Itens ({items.length})</h2>
        <p className="text-xs text-muted">{director ? "Toque em Valores para preencher o cotado, o contratado e o realizado." : "Contratado e Realizado: só o diretor de produção preenche."}</p>
      </div>

      {/* Tela larga: tabela. */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              {["Código", "Item", "Estimado", "Cotado", "Contratado", "Realizado", "Saving", "Estouro", ""].map((h, i) => (
                <th key={i} scope="col" className={cx("px-3 py-2 font-semibold", i >= 2 && i <= 7 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((i) => (
              editing === i.id ? (
                <tr key={i.id}><td colSpan={9} className="bg-white/5 p-4"><ValuesForm item={i} director={director} onDone={() => setEditing(null)} /></td></tr>
              ) : (
                <tr key={i.id} className={cx("align-top", i.optional && "text-muted")}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs"><Link href={itemHref(i.id)} className="text-primary hover:underline">{i.code}</Link></td>
                  <td className="px-3 py-2">{i.name}{i.optional && <span className="ml-1 text-xs">(opcional)</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{i.estimated === null ? <span className="text-amber-300">A definir</span> : brl(i.estimated)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {money(i.quoted)}
                    {i.quotedFrom === "COTACAO" && <span className="block text-xs text-muted">da cotação</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(i.contracted)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(i.actual)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Diff value={i.saving} goodWhenPositive /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Diff value={i.overrun} goodWhenPositive={false} /></td>
                  <td className="px-3 py-0.5 text-right">
                    <Button variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setEditing(i.id)}>Valores</Button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular: cartões. */}
      <ul className="divide-y divide-border lg:hidden">
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3">
            {editing === i.id ? <ValuesForm item={i} director={director} onDone={() => setEditing(null)} /> : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={itemHref(i.id)} className="font-mono text-xs text-primary">{i.code}</Link>
                    <p className={cx("font-medium", i.optional && "text-muted")}>{i.name}</p>
                  </div>
                  <Button variant="ghost" className="min-h-9 shrink-0 px-2 text-sm" onClick={() => setEditing(i.id)}>Valores</Button>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <Pair label="Estimado">{i.estimated === null ? <span className="text-amber-300">A definir</span> : brl(i.estimated)}</Pair>
                  <Pair label="Cotado">{money(i.quoted)}</Pair>
                  <Pair label="Contratado">{money(i.contracted)}</Pair>
                  <Pair label="Realizado">{money(i.actual)}</Pair>
                  {i.saving !== null && <Pair label="Saving"><Diff value={i.saving} goodWhenPositive /></Pair>}
                  {i.overrun !== null && <Pair label="Estouro"><Diff value={i.overrun} goodWhenPositive={false} /></Pair>}
                </dl>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

const field = (v: number | null) => (v === null ? "" : decimal(v));

function ValuesForm({ item, director, onDone }: { item: Item; director: boolean; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typedQuote = item.quotedFrom !== "COTACAO";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const val = (k: string) => (String(f.get(k) ?? "").trim() || null);
        const body: Record<string, unknown> = {};
        if (typedQuote) body.quotedValue = val("quotedValue");
        if (director) Object.assign(body, { contractedValue: val("contractedValue"), actualValue: val("actualValue") });
        setBusy(true);
        setError(null);
        try {
          await api(`/api/cost-items/${item.id}`, { method: "PATCH", body });
          onDone();
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-medium"><span className="font-mono text-xs text-primary">{item.code}</span> {item.name}</p>
      <p className="text-sm text-muted">Estimado (da planilha): {item.estimated === null ? "a definir" : brl(item.estimated)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <Label hint={typedQuote ? "(R$, sem cotação)" : "(vem da cotação)"}>Cotado</Label>
          {typedQuote
            ? <Input name="quotedValue" inputMode="decimal" defaultValue={field(item.quoted)} placeholder="0,00" className="text-right tabular-nums" />
            : <Input value={field(item.quoted)} disabled readOnly className="text-right tabular-nums" />}
        </label>
        <label className="block">
          <Label hint={director ? "(R$)" : "(só o diretor)"}>Contratado</Label>
          <Input name="contractedValue" inputMode="decimal" defaultValue={field(item.contracted)} placeholder="0,00" disabled={!director} className="text-right tabular-nums" />
        </label>
        <label className="block">
          <Label hint={director ? "(R$, quando pago)" : "(só o diretor)"}>Realizado</Label>
          <Input name="actualValue" inputMode="decimal" defaultValue={field(item.actual)} placeholder="0,00" disabled={!director} className="text-right tabular-nums" />
        </label>
      </div>
      {director && <p className="text-xs text-muted">Preencher o Contratado põe o item em Contratado.</p>}
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || (!director && !typedQuote)} className="min-h-10 px-4 text-sm">{busy ? "Salvando..." : "Salvar"}</Button>
        <Button type="button" variant="secondary" className="min-h-10 px-4 text-sm" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}
