import { authed, body } from "@/server/http/handler";
import { setSectionReceiver } from "@/modules/receipts/receipts.service";

/** Mesma pessoa recebe todos os itens da seção (só o gerente). */
export const PUT = authed<{ sectionId: string }>(async ({ req, actor, params }) =>
  setSectionReceiver(actor, params.sectionId, await body(req)),
);
