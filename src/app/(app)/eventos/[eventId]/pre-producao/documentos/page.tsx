import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { getEvent } from "@/modules/events/events.service";
import { listDocuments } from "@/modules/documents/documents.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { DocumentList } from "@/components/document-list";
import { Icon } from "@/components/icons";
import { PAGE, buttonClass, cx } from "@/components/ui";
import { DOCUMENT_CATEGORIES } from "@/lib/documents";
import { DocumentActions, UploadForm } from "./forms";

export const metadata = { title: "Documentos do evento" };

/** Central de documentos: enviar com categoria, filtrar, abrir, liberar para o campo. */
export default async function DocumentsPage({ params, searchParams }: PageProps<"/eventos/[eventId]/pre-producao/documentos">) {
  const { eventId } = await params;
  const sp = await searchParams;
  const actor = await requireUser();
  const [event, data] = await Promise.all([getEvent(actor, eventId), listDocuments(actor, eventId)]).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const base = `/eventos/${eventId}/pre-producao/documentos`;
  const used = DOCUMENT_CATEGORIES.filter((c) => data.documents.some((d) => d.category === c.key));
  const filter = typeof sp.categoria === "string" && used.some((c) => c.key === sp.categoria) ? sp.categoria : null;
  const released = data.documents.filter((d) => d.visibleToField).length;
  const chip = (active: boolean) =>
    cx("shrink-0 rounded-full border px-3 py-1.5 text-sm", active ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted hover:text-foreground");

  return (
    <>
      <TopBar title="Documentos" subtitle={event.name} back={`/eventos/${eventId}/pre-producao`} />
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Pré-produção"]} title="Documentos do evento" />
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {data.documents.length === 0
              ? "Nenhum documento ainda."
              : `${data.documents.length} ${data.documents.length === 1 ? "documento" : "documentos"} · ${released} ${released === 1 ? "liberado" : "liberados"} para o campo. Toque num arquivo para ver os detalhes.`}
          </p>
          <details className="group max-w-2xl" open={data.documents.length === 0}>
            <summary className={buttonClass("primary", "w-full cursor-pointer list-none sm:w-auto")}>
              <Icon name="upload" className="h-5 w-5" /> Enviar documento
            </summary>
            <div className="mt-3">
              <UploadForm eventId={eventId} canRelease={data.canRelease} maxBytes={data.maxBytes} />
            </div>
          </details>
          {used.length > 1 && (
            <nav aria-label="Filtrar por categoria" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
              <Link href={base} className={chip(!filter)}>Todos</Link>
              {used.map((c) => (
                <Link key={c.key} href={`${base}?categoria=${c.key}`} className={chip(filter === c.key)}>{c.label}</Link>
              ))}
            </nav>
          )}
          <DocumentList
            docs={data.documents}
            filter={filter}
            actions={Object.fromEntries(data.documents.map((d) => [d.id, <DocumentActions key={d.id} doc={d} canRelease={data.canRelease} />]))}
          />
        </div>
      </main>
    </>
  );
}
