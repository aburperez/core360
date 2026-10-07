import { redirect } from "next/navigation";

/** A lista de briefings agora fica no painel de funções, junto com função, agenda e ficha. */
export default async function BriefingsPage({ params }: PageProps<"/eventos/[eventId]/pre-producao/briefing">) {
  const { eventId } = await params;
  redirect(`/eventos/${eventId}/pre-producao/funcoes`);
}
