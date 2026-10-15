"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { cx } from "./ui";

/*
 * Lista em grade no estilo do “browse” do Protheus, só no computador (lg):
 * bolinha de legenda, pesquisa pelo campo escolhido (índice), ordenar pela
 * coluna, linha selecionada, duplo clique abre, botões padrão no topo
 * (Incluir, Alterar, Visualizar) e exportar para planilha. No celular a tela
 * continua com os cartões; quem usa este componente esconde os cartões em lg.
 */

/** `wrap`: a coluna pode quebrar linha (textos longos); as outras ficam numa linha só. */
export type BrowseColumn = { key: string; label: string; align?: "right" | "center"; width?: string; wrap?: boolean };

export type BrowseRow = {
  id: string;
  /** Visualizar (duplo clique e Enter). */
  href: string;
  /** Alterar, quando a tela tem edição separada. */
  editHref?: string;
  /** Cor da bolinha (classe bg-*), de acordo com a legenda. */
  dot?: string;
  /** Texto de cada coluna: usado para pesquisar, ordenar e exportar. */
  text: Record<string, string>;
  /** Célula desenhada (opcional); sem ela aparece o texto. */
  cells?: Record<string, ReactNode>;
};

export type LegendItem = { dot: string; label: string };

export function Browse({
  title,
  columns,
  rows,
  legend,
  actions,
  filters,
  empty,
  exportName,
}: {
  title: string;
  columns: BrowseColumn[];
  rows: BrowseRow[];
  legend?: LegendItem[];
  /** Botões à direita do título (Incluir etc.). Visualizar e Alterar entram sozinhos. */
  actions?: ReactNode;
  /** Filtros à esquerda da pesquisa (por exemplo a situação). */
  filters?: ReactNode;
  empty?: ReactNode;
  exportName?: string;
}) {
  const router = useRouter();
  const searchable = columns.filter((c) => c.key !== "dot");
  const [index, setIndex] = useState(searchable[0]?.key ?? "");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const list = q ? rows.filter((r) => (r.text[index] ?? "").toLocaleLowerCase("pt-BR").includes(q)) : rows;
    if (!sort) return list;
    return [...list].sort((a, b) => sort.dir * (a.text[sort.key] ?? "").localeCompare(b.text[sort.key] ?? "", "pt-BR", { numeric: true }));
  }, [rows, query, index, sort]);

  const current = shown.find((r) => r.id === selected) ?? null;
  const open = (r: BrowseRow | null, edit = false) => {
    if (!r) return;
    router.push(edit && r.editHref ? r.editHref : r.href);
  };
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [searchable.map((c) => esc(c.label)).join(";"), ...shown.map((r) => searchable.map((c) => esc(r.text[c.key] ?? "")).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName ?? title}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const hasEdit = rows.some((r) => r.editHref);

  return (
    <section className="hidden flex-col lg:flex" aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {filters}
        <select
          value={index}
          onChange={(e) => setIndex(e.target.value)}
          aria-label="Pesquisar pelo campo"
          className="h-8 rounded-sm border border-border bg-background px-2 text-[13px] text-foreground"
        >
          {searchable.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex h-8 min-w-40 max-w-80 flex-1 items-center gap-2 rounded-sm border border-border bg-background px-2 text-[13px] focus-within:border-primary">
          <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
        </label>
        {legend && legend.length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setShowLegend((v) => !v)} aria-expanded={showLegend} className={toolButton}>
              Legenda
            </button>
            {showLegend && (
              <div className="absolute left-0 top-full z-30 mt-1 w-64 border border-border bg-surface p-3 text-[13px] shadow-2xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Legenda</p>
                <ul className="space-y-2">
                  {legend.map((l) => (
                    <li key={l.label} className="flex items-center gap-2.5">
                      <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", l.dot)} /> {l.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={exportCsv} disabled={shown.length === 0} className={toolButton}>
          <Icon name="download" className="h-3.5 w-3.5" /> Planilha
        </button>
        <button type="button" onClick={() => window.print()} className={toolButton}>
          <Icon name="report" className="h-3.5 w-3.5" /> Imprimir
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button type="button" disabled={!current} onClick={() => open(current)} className={toolButton}>
          <Icon name="search" className="h-3.5 w-3.5" /> Visualizar
        </button>
        {hasEdit && (
          <button type="button" disabled={!current?.editHref} onClick={() => open(current, true)} className={toolButton}>
            <Icon name="edit" className="h-3.5 w-3.5" /> Alterar
          </button>
        )}
        {actions}
      </div>
      <div className="overflow-x-auto border border-border bg-[#04293a]">
        <table data-browse className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {legend && <th className="w-7 border-b border-r border-border bg-[#073447] px-2 py-1.5" aria-label="Legenda" />}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cx(
                    "whitespace-nowrap border-b border-r border-border bg-[#073447] px-2 py-1.5 font-semibold text-foreground/85",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                    className="inline-flex items-center gap-1 hover:text-primary"
                  >
                    {c.label}
                    {sort?.key === c.key && <span className="text-[10px] text-primary">{sort.dir === 1 ? "▲" : "▼"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => setSelected(r.id)}
                onDoubleClick={() => open(r)}
                aria-selected={r.id === selected}
                className={cx(
                  "cursor-default",
                  r.id === selected ? "bg-[#0b5168] text-white" : i % 2 ? "bg-[#062f42] hover:bg-[#0a3a50]" : "hover:bg-[#0a3a50]",
                )}
              >
                {legend && (
                  <td className="border-r border-[#0a3a4e] px-2 py-1.5 text-center">
                    <span className={cx("inline-block h-2.5 w-2.5 rounded-full align-middle", r.dot ?? "bg-transparent")} />
                  </td>
                )}
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={cx(
                      "border-r border-[#0a3a4e] px-2 py-1.5",
                      !c.wrap && "whitespace-nowrap",
                      c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "",
                    )}
                  >
                    {ci === 0 ? (
                      // A primeira coluna é um link: dá para abrir com o teclado e com o botão do meio.
                      <Link href={r.href} onFocus={() => setSelected(r.id)} className="hover:text-primary hover:underline">
                        {r.cells?.[c.key] ?? r.text[c.key]}
                      </Link>
                    ) : (
                      (r.cells?.[c.key] ?? r.text[c.key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">{query ? `Nada com “${query}”.` : (empty ?? "Nenhum registro.")}</div>}
      </div>
      <div className="flex gap-4 border border-t-0 border-border bg-surface px-2 py-1 text-[11.5px] text-muted">
        <span>
          {shown.length} de {rows.length} {rows.length === 1 ? "registro" : "registros"}
        </span>
        <span>Índice: {searchable.find((c) => c.key === index)?.label}</span>
        <span className="ml-auto">Duplo clique abre o registro</span>
      </div>
    </section>
  );
}

/** Botão pequeno da barra da lista (padrão Protheus). */
export const toolButton =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm border border-border bg-[#073447] px-3 text-[13px] font-medium text-foreground transition hover:border-primary/60 disabled:pointer-events-none disabled:opacity-40";

/** Botão principal da barra (Incluir). */
export const toolPrimary =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-sm bg-accent px-3.5 text-[13px] font-bold text-accent-foreground transition hover:brightness-110";

/** Filtro da lista como caixa de escolha que troca o endereço (situação, categoria…). */
export function BrowseFilter({ label, value, options }: { label: string; value: string; options: { value: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-sm border border-border bg-background pl-2 text-[13px] text-muted">
      {label}:
      <select
        value={value}
        onChange={(e) => {
          const o = options.find((x) => x.value === e.target.value);
          if (o) router.push(o.href);
        }}
        className="h-full bg-transparent pr-2 font-medium text-foreground outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
