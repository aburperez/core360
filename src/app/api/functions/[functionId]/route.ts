import { authed, body } from "@/server/http/handler";
import { deleteFunction, getFunction, updateFunction } from "@/modules/functions/functions.service";

export const GET = authed<{ functionId: string }>(({ actor, params }) => getFunction(actor, params.functionId));
export const PATCH = authed<{ functionId: string }>(async ({ req, actor, params }) =>
  updateFunction(actor, params.functionId, await body(req)),
);
export const DELETE = authed<{ functionId: string }>(({ actor, params }) => deleteFunction(actor, params.functionId));
