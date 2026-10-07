import { authed, body } from "@/server/http/handler";
import { updateClient } from "@/modules/clients/clients.service";

export const PATCH = authed<{ clientId: string }>(async ({ req, actor, params }) => updateClient(actor, params.clientId, await body(req)));
