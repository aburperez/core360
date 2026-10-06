import { authed, body } from "@/server/http/handler";
import { getServiceType, updateServiceType } from "@/modules/service-types/service-types.service";

export const GET = authed<{ typeId: string }>(({ actor, params }) => getServiceType(actor, params.typeId));

export const PATCH = authed<{ typeId: string }>(async ({ req, actor, params }) =>
  updateServiceType(actor, params.typeId, await body(req)),
);
