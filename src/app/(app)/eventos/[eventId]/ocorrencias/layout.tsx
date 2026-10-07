import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField, clientCan, isClient } from "@/server/authz/policy";

/** Chamados são do campo (e do Cliente com o andamento liberado, só olhando). */
export default async function OccurrencesLayout({ children, params }: LayoutProps<"/eventos/[eventId]/ocorrencias">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (clientCan(actor, eventId, "progress")) return <>{children}</>;
  if (!canUseField(actor, eventId)) redirect(`/eventos/${eventId}${isClient(actor, eventId) ? "" : "/pre-producao"}`);
  return <>{children}</>;
}
