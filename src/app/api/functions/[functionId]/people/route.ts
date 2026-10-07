import { authed, body } from "@/server/http/handler";
import { setFunctionPeople } from "@/modules/functions/functions.service";

/** Quem tem esta função: a lista inteira (os desmarcados ficam sem função). */
export const PUT = authed<{ functionId: string }>(async ({ req, actor, params }) =>
  setFunctionPeople(actor, params.functionId, await body(req)),
);
