import { authed, body } from "@/server/http/handler";
import { checkReceipt } from "@/modules/receipts/receipts.service";

/** Conferência: chegou certo, chegou diferente ou desfazer. */
export const POST = authed<{ receiptId: string }>(async ({ req, actor, params }) =>
  checkReceipt(actor, params.receiptId, await body(req)),
);
