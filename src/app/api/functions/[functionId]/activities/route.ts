import { authed, body } from "@/server/http/handler";
import { addFunctionActivity } from "@/modules/functions/functions.service";

/** Atividade da função: vale para todos que têm a função. */
export const POST = authed<{ functionId: string }>(
  async ({ req, actor, params }) => addFunctionActivity(actor, params.functionId, await body(req)),
  { status: 201 },
);
