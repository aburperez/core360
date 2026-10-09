import { authed, body } from "@/server/http/handler";
import { setAssembled } from "@/modules/receipts/receipts.service";

/** Montado (fase 5B): o Head da área ou o gerente marca ou desfaz ({ done }). */
export const POST = authed<{ receiptId: string }>(async ({ req, actor, params }) =>
  setAssembled(actor, params.receiptId, await body(req)),
);
