import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { getEvent } from "@/modules/events/events.service";
import { listFieldDocuments } from "@/modules/documents/documents.service";
import { TopBar } from "@/components/top-bar";
import { PageHeading } from "@/components/panel";
import { DocumentList } from "@/components/document-list";
import { PAGE, cx } from "@/components/ui";

export const metadata = { title: "Documentos" };

/** Documentos que o gestor liberou para o campo: só leitura. */
export default async function FieldDocumentsPage({ params }: PageProps<"/eventos/[eventId]/documentos">) {
  const { eventId } = await params;
  const actor = await requireUser();
  const [event, docs] = await Promise.all([getEvent(actor, eventId), listFieldDocuments(actor, eventId)]).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  return (
    <>
      <TopBar title="Documentos" subtitle={event.name} back={`/eventos/${eventId}`} />
      <main className={cx(PAGE, "space-y-4 py-4 lg:py-6")}>
        <PageHeading trail={[event.name, "Gestão de campo"]} title="Documentos" />
        <p className="text-sm text-muted">
          {docs.length ? "Liberados pela produção para consulta. Toque para abrir." : "A produção ainda não liberou documentos para o campo."}
        </p>
        <DocumentList docs={docs} />
      </main>
    </>
  );
}
