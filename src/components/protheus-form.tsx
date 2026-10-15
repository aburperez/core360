"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

/*
 * Peças de formulário no estilo Protheus, só no computador (lg). No celular o
 * formulário continua igual: tudo numa coluna, botões embaixo.
 */

/**
 * Pastas do formulário (como as abas do Protheus). No computador mostra uma
 * pasta por vez; no celular as pastas somem e os campos ficam em sequência.
 * As pastas escondidas continuam no formulário (os valores vão no envio); se
 * faltar um campo obrigatório numa pasta escondida, ela abre sozinha.
 * Os campos de cada pasta entram direto na grade do formulário (display: contents).
 */
export function FormFolders({ folders, className }: { folders: { key: string; label: string; content: ReactNode }[]; className?: string }) {
  const [active, setActive] = useState(folders[0]?.key);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  return (
    <>
      <div role="tablist" className={cx("hidden border-b border-border lg:flex", className)}>
        {folders.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={active === f.key}
            onClick={() => setActive(f.key)}
            className={cx(
              "-mb-px rounded-t-sm border border-b-0 px-4 py-2 text-[13px] transition",
              active === f.key ? "border-border bg-surface font-semibold text-primary" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {folders.map((f) => (
        <div
          key={f.key}
          ref={(el) => {
            refs.current[f.key] = el;
          }}
          role="tabpanel"
          aria-label={f.label}
          onInvalidCapture={() => setActive(f.key)}
          className={cx("contents", active !== f.key && "lg:hidden")}
        >
          {f.content}
        </div>
      ))}
    </>
  );
}

/**
 * Topo do formulário no computador: “Fornecedores · INCLUIR” e, à direita,
 * Fechar e Confirmar, como no Protheus. No celular não aparece (os botões
 * ficam embaixo, como sempre).
 */
export function FormHeader({ title, mode, busy, onClose, className }: { title: string; mode: "INCLUIR" | "ALTERAR"; busy?: boolean; onClose?: () => void; className?: string }) {
  return (
    <div className={cx("hidden items-center gap-3 border-b border-border pb-3 lg:flex", className)}>
      <p className="text-[17px] font-semibold">
        {title} <span className="text-muted">·</span> {mode}
      </p>
      <span className="ml-auto" />
      {onClose && (
        <button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-sm border border-border bg-[#073447] px-3.5 text-[13px] font-medium hover:border-primary/60">
          Fechar
        </button>
      )}
      <button type="submit" disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3.5 text-[13px] font-bold text-accent-foreground hover:brightness-110 disabled:opacity-50">
        <Icon name="check" className="h-4 w-4" /> Confirmar
      </button>
    </div>
  );
}

/**
 * Campo com lupa que abre a consulta padrão (F3) para marcar uma ou mais
 * opções numa lista com pesquisa. Só no computador; no celular quem usa
 * mostra a escolha de sempre.
 */
export function LookupMulti<T extends string>({
  label,
  title,
  options,
  value,
  onChange,
  hint,
  className,
}: {
  label: string;
  title: string;
  options: { value: T; label: string; code?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  hint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("hidden lg:block", className)}>
      <span className="mb-1 block text-xs text-muted">
        {label} <span className="text-muted/70">(F3)</span>
        {hint && <span className="ml-1">{hint}</span>}
      </span>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "F3" || e.key === "Enter") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-1 text-[13px] focus:border-primary focus:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {value.length === 0 && <span className="text-muted">Nenhuma escolhida</span>}
          {value.map((v) => (
            <span key={v} className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-foreground">
              {options.find((o) => o.value === v)?.label ?? v}
            </span>
          ))}
        </span>
        <Icon name="search" className="h-3.5 w-3.5 shrink-0 text-primary" />
      </div>
      {open && <LookupDialog title={title} options={options} value={value} onClose={() => setOpen(false)} onOk={(v) => { onChange(v); setOpen(false); }} />}
    </div>
  );
}

function LookupDialog<T extends string>({
  title,
  options,
  value,
  onClose,
  onOk,
}: {
  title: string;
  options: { value: T; label: string; code?: string }[];
  value: T[];
  onClose: () => void;
  onOk: (v: T[]) => void;
}) {
  const [picked, setPicked] = useState<T[]>(value);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);
  const term = q.trim().toLocaleLowerCase("pt-BR");
  const shown = term ? options.filter((o) => `${o.code ?? ""} ${o.label}`.toLocaleLowerCase("pt-BR").includes(term)) : options;
  const toggle = (v: T) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55" role="dialog" aria-modal="true" aria-label={title}>
      <div
        // Recebe o foco ao clicar numa linha, para as setas, o espaço e o Enter continuarem valendo.
        tabIndex={-1}
        className="flex max-h-[80vh] w-[560px] flex-col border border-border bg-surface shadow-2xl outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === " " && shown[cursor] && e.target !== search.current) { e.preventDefault(); toggle(shown[cursor].value); }
          if (e.key === "Enter") { e.preventDefault(); onOk(picked); }
        }}
      >
        <div className="flex h-9 items-center bg-brand-navy px-3 text-[13px] font-semibold">
          Consulta padrão · {title}
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto text-muted hover:text-foreground">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <label className="flex h-8 items-center gap-2 rounded-sm border border-border bg-background px-2 text-[13px] focus-within:border-primary">
            <Icon name="search" className="h-3.5 w-3.5 text-muted" />
            <input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder="Pesquisar" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
          </label>
          <div className="max-h-[50vh] overflow-y-auto border border-border bg-[#04293a]">
            <table data-browse className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="w-8 border-b border-r border-border bg-[#073447] px-2 py-1.5" aria-label="Marcado" />
                  {options.some((o) => o.code) && <th className="border-b border-r border-border bg-[#073447] px-2 py-1.5 text-left font-semibold">Código</th>}
                  <th className="border-b border-border bg-[#073447] px-2 py-1.5 text-left font-semibold">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o, i) => {
                  const on = picked.includes(o.value);
                  return (
                    <tr
                      key={o.value}
                      onClick={() => { setCursor(i); toggle(o.value); }}
                      onDoubleClick={() => onOk(picked.includes(o.value) ? picked : [...picked, o.value])}
                      aria-selected={on}
                      className={cx("cursor-default", i === cursor ? "bg-[#0b5168] text-white" : i % 2 ? "bg-[#062f42]" : "")}
                    >
                      <td className="border-r border-[#0a3a4e] px-2 py-1.5 text-center">
                        <input type="checkbox" checked={on} readOnly tabIndex={-1} className="accent-[var(--primary)]" />
                      </td>
                      {options.some((x) => x.code) && <td className="border-r border-[#0a3a4e] px-2 py-1.5">{o.code}</td>}
                      <td className="px-2 py-1.5">{o.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-3 py-4 text-center text-[13px] text-muted">Nada com “{q}”.</p>}
          </div>
          <p className="text-[11.5px] text-muted">
            {picked.length} {picked.length === 1 ? "marcada" : "marcadas"} · clique marca, duplo clique escolhe e fecha, Enter confirma
          </p>
        </div>
        <div className="flex justify-end gap-1.5 border-t border-border px-3 py-2">
          <button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-sm border border-border bg-[#073447] px-3.5 text-[13px] font-medium hover:border-primary/60">
            Cancelar
          </button>
          <button type="button" onClick={() => onOk(picked)} className="inline-flex h-8 items-center rounded-sm bg-accent px-4 text-[13px] font-bold text-accent-foreground hover:brightness-110">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
