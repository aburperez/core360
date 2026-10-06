import { authed, body } from "@/server/http/handler";
import { getWhatsappSettings, setWhatsappSettings } from "@/modules/notifications/notifications.service";

/** Receber ou não avisos no WhatsApp, e em qual número. */
export const GET = authed(async ({ actor }) => getWhatsappSettings(actor));
export const PUT = authed(async ({ req, actor }) => setWhatsappSettings(actor, await body(req)));
