"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type ReactNode } from "react";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, formatBytes, type DocumentCategoryKey } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { Icon } from "./icons";
import { buttonClass, cx } from "./ui";

/** Sigla e cor do tipo do arquivo. */
function kind(mime: string) {
  if (mime === "application/pdf") return { label: "PDF", color: "#e04545" };
  if (mime.startsWith("image/")) return { label: "IMG", color: "#2f7de1" };
  if (mime.includes("word")) return { label: "DOC", color: "#3b82f6" };
  if (mime.includes("sheet") || mime.includes("excel")) return { label: "XLS", color: "#22a55b" };
  return { label: "PPT", color: "#f2762e" };
}

export type ListedDocument = {
  id: string; category: string; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date;
  visibleToField?: boolean; uploadedBy?: string;
};

const fileUrl = (id: string) => `/api/documents/${id}/file`;

/** Miniatura: a própria imagem ou uma folha desenhada com a sigla do tipo. */
function Thumb({ d, big }: { d: ListedDocument; big?: boolean }) {
  const k = kind(d.mimeType);
  if (d.mimeType.startsWith("image/")) {
    return <img src={fileUrl(d.id)} alt="" loading="lazy" className="h-full w-full object-cover" />;
  }
  return (
    <span className="grid h-full w-full place-items-center">
      <span className={cx("relative rounded-[3px] bg-white shadow-sm", big ? "h-28 w-20" : "h-[76px] w-14")}>
        <span className="absolute left-2 right-3 top-2.5 h-1.5 rounded-sm bg-brand-navy" />
        {[5, 7, 9, 11, 13].map((t) => (
          <span key={t} className="absolute left-2 right-2 h-[3px] rounded-sm bg-slate-300" style={{ top: `${t * (big ? 6 : 4.2)}px` }} />
        ))}
        <span className="absolute bottom-2 left-2 rounded-sm px-1 text-[8px] font-bold text-white" style={{ background: k.color }}>{k.label}</span>
      </span>
    </span>
  );
}

/**
 * Documentos em grade, como uma pasta: miniatura, nome, categoria e tamanho,
 * na ordem das categorias do roadmap. Tocar seleciona e mostra os detalhes (painel
 * à direita no computador, gaveta de baixo no celular); dois cliques abrem.
 * Serve à Pré-produção (com ações) e ao campo (só leitura).
 */
export function DocumentList<D extends ListedDocument>({ docs, actions, filter }: {
  docs: D[]; actions?: Record<string, ReactNode>; filter?: string | null;
}) {
  // Na ordem das categorias do roadmap; dentro delas, o mais novo primeiro.
  const shown = DOCUMENT_CATEGORIES.filter((c) => !filter || c.key === filter).flatMap((c) => docs.filter((d) => d.category === c.key));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((d) => d.id === selectedId) ?? null;
  const [sheet, setSheet] = useState(false);

  if (!shown.length) return null;
  const details = selected ?? shown[0];

  return (
    <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px]">
      <ul className="grid min-w-0 content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
        {shown.map((d) => {
          const k = kind(d.mimeType);
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => { setSelectedId(d.id); setSheet(true); }}
                onDoubleClick={() => window.open(fileUrl(d.id), "_blank", "noopener")}
                aria-pressed={selected?.id === d.id}
                className={cx(
                  "flex w-full flex-col overflow-hidden rounded-xl border bg-surface text-left transition hover:border-primary/70",
                  selected?.id === d.id ? "border-primary ring-1 ring-primary" : "border-border",
                )}
              >
                <span className="relative block h-28 bg-background/60">
                  <Thumb d={d} />
                  {d.mimeType.startsWith("image/") && (
                    <span className="absolute bottom-1.5 left-1.5 rounded px-1.5 text-[10px] font-bold text-white" style={{ background: k.color }}>{k.label}</span>
                  )}
                </span>
                <span className="flex items-start gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold" title={d.title}>{d.title}</span>
                    <span className="block truncate text-xs text-muted">{categoryLabel(d.category)} · {formatBytes(d.sizeBytes)}</span>
                  </span>
                  {d.visibleToField && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" title="O campo vê" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Computador: painel fixo à direita com o arquivo selecionado. */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 rounded-xl border border-border bg-surface p-4">
          <Details d={details} actions={actions?.[details.id]} />
        </div>
      </aside>

      {/* Celular: gaveta de baixo com o arquivo tocado. */}
      {selected && sheet && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={selected.title}>
          <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <Details d={selected} actions={actions?.[selected.id]} compact />
          </div>
        </div>
      )}
    </div>
  );
}

/** Detalhes do arquivo: prévia, tipo, data, quem enviou, etiquetas e ações. */
function Details({ d, actions, compact }: { d: ListedDocument; actions?: ReactNode; compact?: boolean }) {
  const k = kind(d.mimeType);
  const tags = [categoryLabel(d.category), k.label, ...(d.visibleToField ? ["Campo vê"] : [])];
  return (
    <div>
      <p className="flex items-center gap-2 font-semibold"><Icon name="info" className="h-5 w-5 text-primary" /> Detalhes do arquivo</p>
      {!compact && (
        <div className="mt-3 h-40 overflow-hidden rounded-lg bg-background/60">
          <Thumb d={d} big />
        </div>
      )}
      <dl className="mt-3 divide-y divide-border text-sm">
        <Row label="Nome">{d.title}</Row>
        <Row label="Arquivo">{d.fileName} · {formatBytes(d.sizeBytes)}</Row>
        <Row label="Enviado">{formatDate(d.createdAt)}{d.uploadedBy ? ` por ${d.uploadedBy}` : ""}</Row>
        <div className="py-2.5">
          <dt className="text-xs font-bold">Etiquetas</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((t) => <span key={t} className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">{t}</span>)}
          </dd>
        </div>
      </dl>
      <a href={fileUrl(d.id)} target="_blank" rel="noopener" className={buttonClass("primary", "mt-2 w-full")}>
        <Icon name="download" className="h-5 w-5" /> Abrir
      </a>
      {actions && <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border pt-3">{actions}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-bold">{label}</dt>
      <dd className="mt-0.5 break-words text-muted">{children}</dd>
    </div>
  );
}

const categoryLabel = (k: string) => DOCUMENT_CATEGORY_LABEL[k as DocumentCategoryKey] ?? k;
