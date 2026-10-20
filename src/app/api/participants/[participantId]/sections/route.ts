import { authed, body } from "@/server/http/handler";
import { setProducerAccess } from "@/modules/participants/producer-access.service";

/** Marcar as partes da Pré-produção que o Pré-produtor abre: { sections: [...] }. */
export const PUT = authed<{ participantId: string }>(async ({ req, actor, params }) =>
  setProducerAccess(actor, params.participantId, await body(req)),
);
