import { redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { canUseField } from "@/server/authz/policy";

/** Chamados são do campo: o Pré-produtor volta para a Pré-produção. */
export default async function OccurrencesLayout({ children, params }: LayoutProps<"/eventos/[eventId]/ocorrencias">) {
  const actor = await requireUser();
  const { eventId } = await params;
  if (!canUseField(actor, eventId)) redirect(`/eventos/${eventId}/pre-producao`);
  return <>{children}</>;
}
