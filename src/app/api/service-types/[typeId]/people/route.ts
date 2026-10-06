import { authed, body } from "@/server/http/handler";
import { setServiceTypePerson } from "@/modules/service-types/service-types.service";

/** Marca ou desmarca quem faz este tipo de atendimento. */
export const POST = authed<{ typeId: string }>(async ({ req, actor, params }) =>
  setServiceTypePerson(actor, params.typeId, await body(req)),
);
