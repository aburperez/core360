import { authed, body } from "@/server/http/handler";
import { setSupplierArchived } from "@/modules/suppliers/suppliers.service";

/** Arquivar ou reativar ({ archived }): só o diretor. */
export const POST = authed<{ eventId: string; supplierId: string }>(async ({ req, actor, params }) =>
  setSupplierArchived(actor, params.eventId, params.supplierId, await body(req)));
