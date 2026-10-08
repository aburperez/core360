import { notFound } from "next/navigation";
import { requireUser } from "@/server/http/session";
import { NotFoundError } from "@/server/errors";
import { getEvent } from "@/modules/events/events.service";
import { getEventBriefing } from "@/modules/events/briefing.service";
import { formatPeriod } from "@/lib/format";

/** Evento e briefing para a página e o relatório; quem não é da pré-produção recebe 404. */
export async function loadEventBriefing(eventId: string) {
  const actor = await requireUser();
  const [event, briefing] = await Promise.all([getEvent(actor, eventId), getEventBriefing(actor, eventId)]).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const tz = event.timezone;
  // Cidade/UF só se o endereço ainda não as tiver.
  const cityUf = [event.city, event.state].filter(Boolean).join("/");
  const place = [event.venue, event.address, event.address?.includes(event.city ?? "\u0000") ? null : cityUf].filter(Boolean).join(" · ");
  // O que vem da ficha do evento (fonte única): aparece no briefing, mas muda só na ficha.
  const ficha: [string, string][] = [
    ["Evento", event.name],
    ["Cliente", event.client.name],
    ["Tipo", event.eventType ?? "—"],
    ["Projeto", event.project ?? "—"],
    ["Datas", formatPeriod(event.startsAt, event.endsAt, tz, true)],
    ["Montagem", event.setupStartsAt ? formatPeriod(event.setupStartsAt, event.setupEndsAt, tz, true) : "—"],
    ["Público estimado", event.expectedAudience != null ? `${event.expectedAudience.toLocaleString("pt-BR")} pessoas` : "—"],
    ["Local", place || "—"],
  ];
  return { actor, event, briefing, ficha };
}
