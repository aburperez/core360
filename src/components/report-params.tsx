"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { toolButton, toolPrimary } from "./browse";
import { cx } from "./ui";

type Output = "tela" | "pdf" | "excel";

/**
 * Relatório com a janela de parâmetros do Protheus, só no computador (lg): ao
 * abrir, a pessoa escolhe as seções, o papel (em pé ou deitado) e a saída
 * (tela, PDF ou planilha) e confirma com OK. O botão Parâmetros reabre a
 * janela. No celular tudo aparece direto, como sempre.
 */
export function ReportParams({
  title,
  sections,
  excelHref,
  wide,
  toolbar,
  header,
  children,
}: {
  title: string;
  sections: string[];
  excelHref: string;
  wide: boolean;
  /** Barra de cima (dica, Excel e PDF); o botão Parâmetros entra à esquerda no computador. */
  toolbar: ReactNode;
  /** Cabeçalho da folha branca. */
  header: ReactNode;
  children: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);
  const [landscape, setLandscape] = useState(wide);
  const [output, setOutput] = useState<Output>("tela");

  // A janela abre sozinha na chegada, só no computador.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Esc fecha a janela, esteja o foco onde estiver.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ok = () => {
    setOpen(false);
    if (output === "pdf") setTimeout(() => window.print(), 50);
    if (output === "excel") window.location.href = excelHref;
  };

  return (
    <>
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; }`}</style>
      <div className="flex flex-col lg:mb-3 lg:flex-row lg:items-center lg:gap-3">
        <span className="hidden print:hidden lg:block">
          <button type="button" onClick={() => setOpen(true)} className={toolButton}>
            <Icon name="filter" className="h-3.5 w-3.5" /> Parâmetros
          </button>
        </span>
        <span className="hidden text-[12px] text-muted print:hidden lg:inline">
          {sections.length - hidden.length} de {sections.length} seções · papel {landscape ? "deitado" : "em pé"}
        </span>
        {toolbar}
      </div>
      <article className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl sm:p-8 lg:in-[.protheus]:rounded-sm print:rounded-none print:p-0 print:shadow-none">
        {header}
        {children.map((c, i) => (
          <div key={i} className={cx(hidden.includes(i) && "lg:hidden print:hidden")}>
            {c}
          </div>
        ))}
      </article>
      {open && (
        <div className="fixed inset-0 z-[60] hidden items-center justify-center bg-black/55 print:hidden lg:flex" role="dialog" aria-modal="true" aria-label={`Parâmetros · ${title}`}>
          <div className="flex max-h-[85vh] w-[620px] flex-col border border-border bg-surface text-foreground shadow-2xl">
            <div className="flex h-9 items-center bg-brand-navy px-3 text-[13px] font-semibold">
              Parâmetros · {title}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="ml-auto text-muted hover:text-foreground">
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-4 text-[13px]">
              <fieldset>
                <legend className="mb-1.5 flex w-full items-center text-xs text-muted">
                  Seções do relatório
                  <button type="button" className="ml-auto text-primary hover:underline" onClick={() => setHidden(hidden.length ? [] : sections.map((_, i) => i))}>
                    {hidden.length ? "Marcar todas" : "Desmarcar todas"}
                  </button>
                </legend>
                <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto border border-border bg-background p-2">
                  {sections.map((s, i) => (
                    <label key={i} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={!hidden.includes(i)}
                        onChange={() => setHidden((h) => (h.includes(i) ? h.filter((x) => x !== i) : [...h, i]))}
                        className="accent-[var(--primary)]"
                      />
                      <span className="truncate">{s}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-4">
                <Choice
                  label="Papel"
                  value={landscape ? "deitado" : "pe"}
                  onChange={(v) => setLandscape(v === "deitado")}
                  options={[
                    { value: "pe", label: "Em pé (retrato)" },
                    { value: "deitado", label: "Deitado (paisagem)" },
                  ]}
                />
                <Choice
                  label="Saída"
                  value={output}
                  onChange={(v) => setOutput(v as Output)}
                  options={[
                    { value: "tela", label: "Ver na tela" },
                    { value: "pdf", label: "Imprimir ou salvar em PDF" },
                    { value: "excel", label: "Planilha Excel (completa)" },
                  ]}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t border-border px-3 py-2">
              <span className="mr-auto text-[11.5px] text-muted">A planilha sai sempre com todas as seções.</span>
              <button type="button" onClick={() => setOpen(false)} className={toolButton}>
                Cancelar
              </button>
              <button type="button" onClick={ok} disabled={hidden.length === sections.length && output !== "excel"} className={cx(toolPrimary, "disabled:opacity-40")}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs text-muted">{label}</legend>
      <div className="grid gap-1 border border-border bg-background p-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 py-0.5">
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} className="accent-[var(--primary)]" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
