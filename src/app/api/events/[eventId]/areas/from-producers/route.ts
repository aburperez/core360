import { authed } from "@/server/http/handler";
import { createProducerAreas } from "@/modules/areas/areas.service";

/** Cria as áreas do evento a partir da lista de Produtores e Funções. */
export const POST = authed<{ eventId: string }>(({ actor, params }) => createProducerAreas(actor, params.eventId));
