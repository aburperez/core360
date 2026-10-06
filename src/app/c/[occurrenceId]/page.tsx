import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { uuid } from "@/lib/validation";

/**
 * Link curto dos avisos (WhatsApp e app): /c/<chamado>. Leva para a tela do
 * chamado se a pessoa puder vê-lo; a RLS decide, como em qualquer outra tela.
 */
export default async function ShortLink({ params }: PageProps<"/c/[occurrenceId]">) {
  const { occurrenceId } = await params;
  const actor = await requireUser(`/c/${occurrenceId}`);
  if (!uuid.safeParse(occurrenceId).success) notFound();
  const o = await actor.run((tx) => tx.occurrence.findUnique({ where: { id: occurrenceId }, select: { eventId: true } }));
  if (!o) notFound();
  redirect(`/eventos/${o.eventId}/ocorrencias/${occurrenceId}`);
}
