import { authed, body } from "@/server/http/handler";
import { setItemReceiver } from "@/modules/receipts/receipts.service";

/** Quem recebe o item no campo (só o gerente). */
export const PUT = authed<{ itemId: string }>(async ({ req, actor, params }) =>
  setItemReceiver(actor, params.itemId, await body(req)),
);
