import { authed } from "@/server/http/handler";
import { listReceipts } from "@/modules/receipts/receipts.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => listReceipts(actor, params.eventId));
