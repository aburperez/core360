import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canSeeEvent, canBuildTeam, canUseField, canUsePreProduction, isClient } from "@/server/authz/policy";
import { isAgencyAdmin, isEventAdmin, isEventSupport, membershipFor } from "@/server/authz/actor";
import { EventNav } from "@/components/event-nav";
import { hasReceipts } from "@/modules/receipts/receipts.service";
import { myBriefingState } from "@/modules/briefings/briefings.service";
import { myPlanSummary } from "@/modules/functions/functions.service";
import { fieldDocumentCount } from "@/modules/documents/documents.service";
import { canSeeContractedSuppliers } from "@/modules/suppliers/supplier-meta";
import { canSeeArrivals } from "@/modules/arrivals/arrivals.service";

export default async function EventLayout({ children, params }: LayoutProps<"/eventos/[eventId]">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canSeeEvent(actor, eventId)) notFound();
  const role = isEventAdmin(actor, eventId) ? "ADMIN" : membershipFor(actor, eventId)?.role;
  const [receipts, briefing, plan, docs] = await Promise.all([
    hasReceipts(actor, eventId), myBriefingState(actor, eventId), myPlanSummary(actor, eventId), fieldDocumentCount(actor, eventId),
  ]);
  return (
    <div className="pb-nav lg:pb-0 lg:pl-60 print:p-0">
      {isEventSupport(actor, eventId) && (
        <p className="bg-amber-500/15 print:hidden px-4 py-2 text-center text-sm text-amber-100">
          Você está aqui como <b>Suporte</b>, autorizado pela agência. Tudo o que você faz fica registrado.
        </p>
      )}
      {children}
      <EventNav
        eventId={eventId}
        canCreate={role !== "CLIENTE" && role !== "PRE_PRODUTOR"}
        canSeeTickets={role !== "CLIENTE" && role !== "PRE_PRODUTOR"}
        canUseField={canUseField(actor, eventId)}
        canUsePre={canUsePreProduction(actor, eventId)}
        canBuildTeam={canBuildTeam(actor, eventId)}
        hasReceipts={receipts}
        hasBriefing={briefing !== "SEM" || plan.has}
        hasDocuments={docs > 0}
        canSeeSuppliers={canUseField(actor, eventId) && canSeeContractedSuppliers(actor, eventId)}
        canSeeArrivals={canUseField(actor, eventId) && canSeeArrivals(actor, eventId)}
        client={isClient(actor, eventId) ? (membershipFor(actor, eventId)?.clientView ?? null) : null}
        canSwitchEvent={actor.memberships.length > 1 || isAgencyAdmin(actor) || actor.isPlatformAdmin}
      />
    </div>
  );
}
