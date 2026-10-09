import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, canUsePreProduction } from "@/server/authz/policy";
import { getEvent } from "@/modules/events/events.service";
import { listReceipts } from "@/modules/receipts/receipts.service";
import { TopBar } from "@/components/top-bar";
import { EventTabs } from "@/components/event-nav";
import { EmptyState, PAGE, cx } from "@/components/ui";
import { ReceiptList } from "./receipt-list";

export const metadata = { title: "Recebimentos" };

/**
 * Itens que a Pré-produção mandou para o campo, para conferir na chegada.
 * Quem recebe vê os seus; o Head da área vê os da área e marca Montado e
 * Conferido (fase 5B); o gerente vê todos. Sem valores.
 */
export default async function ReceiptsPage({ params }: PageProps<"/eventos/[eventId]/recebimentos">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId)) notFound();
  const [event, { all, rows }] = await Promise.all([getEvent(actor, eventId), listReceipts(actor, eventId)]);
  const pending = rows.filter((r) => r.status === "PENDENTE" && r.canReceive).length;
  const toAssemble = rows.filter((r) => r.canAssemble && r.status !== "PENDENTE" && !r.checkedAt).length;
  const assembly = rows.some((r) => r.canAssemble);

  return (
    <>
      <TopBar title="Recebimentos" subtitle={event.name} />
      {canUsePreProduction(actor, eventId) && <EventTabs eventId={eventId} active="campo" />}
      <main className={cx(PAGE, "py-4 lg:py-6")}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum item para receber">
            {all
              ? "Na Pré-produção › Custos, escolha quem recebe cada item e toque em “Enviar para o campo”."
              : "Quando o gerente enviar itens para você conferir, eles aparecem aqui."}
          </EmptyState>
        ) : (
          <>
            <p className="mb-3 px-1 text-sm text-muted">
              {pending ? `${pending} ${pending === 1 ? "item aguardando" : "itens aguardando"} chegada. ` : ""}
              {assembly && toAssemble ? `${toAssemble} ${toAssemble === 1 ? "item para montar ou conferir" : "itens para montar ou conferir"}. ` : ""}
              {assembly
                ? "Quando o item chegar, marque Montado e depois Conferido, com uma foto do item montado."
                : "Confira cada item quando chegar e marque se veio certo ou diferente."}
            </p>
            <ReceiptList rows={rows} all={all} />
          </>
        )}
      </main>
    </>
  );
}
