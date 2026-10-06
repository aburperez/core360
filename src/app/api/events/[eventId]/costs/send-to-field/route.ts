import { authed } from "@/server/http/handler";
import { sendToField } from "@/modules/receipts/receipts.service";

/** Envia para o campo os itens que têm quem recebe (sem valores). */
export const POST = authed<{ eventId: string }>(({ actor, params }) => sendToField(actor, params.eventId));
