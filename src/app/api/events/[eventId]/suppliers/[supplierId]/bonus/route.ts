import { authed, body } from "@/server/http/handler";
import { setSupplierBonus } from "@/modules/suppliers/suppliers.service";

type P = { eventId: string; supplierId: string };

/** Bonificação ({ kind, value, notes }): só o diretor. */
export const PUT = authed<P>(async ({ req, actor, params }) => setSupplierBonus(actor, params.eventId, params.supplierId, await body(req)));

export const DELETE = authed<P>(({ actor, params }) => setSupplierBonus(actor, params.eventId, params.supplierId, null));
