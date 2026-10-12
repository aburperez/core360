import type { PriceEntry } from "@/modules/intelligence/intelligence.service";
import { CATEGORY } from "@/modules/items/item-meta";
import { brl, decimal } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cx } from "./ui";

const qty = (p: PriceEntry) => `${decimal(p.quantity)}${p.unit ? ` ${p.unit}` : ""}`;

function Cost({ p }: { p: PriceEntry }) {
  return (
    <>
      <span className="font-semibold tabular-nums">{brl(p.cost)}</span>
      <span className={cx("block text-xs", p.paid ? "text-emerald-300" : "text-muted")}>{p.paid ? "realizado" : "contratado"}</span>
    </>
  );
}

function EventLine({ p }: { p: PriceEntry }) {
  return (
    <>
      {p.eventName} · {formatDate(p.startsAt)}
      {p.archived && <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">encerrado</span>}
    </>
  );
}

/** Preços de itens de eventos da agência (banco de preços e cotação). */
export function PriceList({ items, compact }: { items: PriceEntry[]; compact?: boolean }) {
  return (
    <section className="rounded-2xl border border-border bg-surface" aria-label="Preços">
      {!compact && (
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                {["Item", "Evento", "Fornecedor", "Quantidade", "Valor", "Por unidade"].map((h, k) => (
                  <th key={h} scope="col" className={cx("px-3 py-2 font-semibold", k >= 3 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((p) => (
                <tr key={`${p.eventId}-${p.code}`} className="align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted">{p.code}{p.category ? ` · ${CATEGORY[p.category].label}` : ""}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted"><EventLine p={p} /><span className="block text-xs">{p.client}</span></td>
                  <td className="px-3 py-2.5">{p.supplier ?? <span className="text-muted">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{qty(p)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right"><Cost p={p} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{p.perUnit === null ? "—" : brl(p.perUnit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul className={cx("divide-y divide-border", !compact && "lg:hidden")}>
        {items.map((p) => (
          <li key={`${p.eventId}-${p.code}`} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted"><EventLine p={p} /></p>
              <p className="mt-0.5 text-xs text-muted">
                {qty(p)}{p.perUnit !== null && p.quantity !== 1 ? ` · ${brl(p.perUnit)} cada` : ""}{p.supplier ? ` · ${p.supplier}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right text-sm"><Cost p={p} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
