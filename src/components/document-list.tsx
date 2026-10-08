import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, formatBytes, type DocumentCategoryKey } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { cx } from "./ui";

/** Sigla e cor do tipo do arquivo. */
function kind(mime: string) {
  if (mime === "application/pdf") return { label: "PDF", tone: "bg-red-500/20 text-red-200" };
  if (mime.startsWith("image/")) return { label: "IMG", tone: "bg-violet-500/20 text-violet-200" };
  if (mime.includes("word")) return { label: "DOC", tone: "bg-sky-500/20 text-sky-200" };
  if (mime.includes("sheet") || mime.includes("excel")) return { label: "XLS", tone: "bg-emerald-500/20 text-emerald-200" };
  return { label: "PPT", tone: "bg-orange-500/20 text-orange-200" };
}

export type ListedDocument = {
  id: string; category: string; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: Date;
  visibleToField?: boolean; uploadedBy?: string;
};

/**
 * Documentos agrupados por categoria, na ordem do roadmap. Serve à
 * Pré-produção (com ações) e ao campo (só leitura).
 */
export function DocumentList<D extends ListedDocument>({ docs, actions, filter }: {
  docs: D[]; actions?: (d: D) => React.ReactNode; filter?: string | null;
}) {
  const groups = DOCUMENT_CATEGORIES
    .filter((c) => !filter || c.key === filter)
    .map((c) => ({ ...c, docs: docs.filter((d) => d.category === c.key) }))
    .filter((g) => g.docs.length);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.key} className="rounded-2xl border border-border bg-surface p-4 lg:p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {g.label} ({g.docs.length})
          </h2>
          <ul className="mt-2 divide-y divide-border">
            {g.docs.map((d) => {
              const k = kind(d.mimeType);
              return (
                <li key={d.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3">
                  <span className={cx("grid h-10 w-10 place-items-center rounded-lg text-xs font-bold", k.tone)}>{k.label}</span>
                  <div className="min-w-0">
                    <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener" className="block break-words font-semibold text-primary" title={d.fileName}>
                      {d.title}
                    </a>
                    <p className="break-words text-xs text-muted">
                      {d.fileName} · {formatBytes(d.sizeBytes)} · {formatDate(d.createdAt)}
                      {d.uploadedBy ? ` · ${d.uploadedBy}` : ""}
                    </p>
                    {d.visibleToField && <span className="mt-1 inline-block rounded-full bg-cyan-400/15 px-2 py-0.5 text-xs text-cyan-200">Campo vê</span>}
                  </div>
                  {actions?.(d)}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export const categoryLabel = (k: string) => DOCUMENT_CATEGORY_LABEL[k as DocumentCategoryKey] ?? k;
