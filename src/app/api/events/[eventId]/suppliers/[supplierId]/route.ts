import { authed, body } from "@/server/http/handler";
import { getSupplier, updateSupplier } from "@/modules/suppliers/suppliers.service";

type P = { eventId: string; supplierId: string };

export const GET = authed<P>(({ actor, params }) => getSupplier(actor, params.eventId, params.supplierId));

export const PATCH = authed<P>(async ({ req, actor, params }) => updateSupplier(actor, params.eventId, params.supplierId, await body(req)));
