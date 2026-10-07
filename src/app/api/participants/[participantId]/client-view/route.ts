import { authed, body } from "@/server/http/handler";
import { setClientView } from "@/modules/participants/client-views.service";

/** Liberar ou fechar o que o Cliente vê: { costs?, team?, progress? }. */
export const PATCH = authed<{ participantId: string }>(async ({ req, actor, params }) =>
  setClientView(actor, params.participantId, await body(req)),
);
