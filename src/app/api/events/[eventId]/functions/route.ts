import { authed, body } from "@/server/http/handler";
import { createFunction, getFunctionsPanel } from "@/modules/functions/functions.service";

/** Painel de funções: funções do evento e as pessoas do campo. */
export const GET = authed<{ eventId: string }>(({ actor, params }) => getFunctionsPanel(actor, params.eventId));

export const POST = authed<{ eventId: string }>(
  async ({ req, actor, params }) => createFunction(actor, params.eventId, await body(req)),
  { status: 201 },
);
