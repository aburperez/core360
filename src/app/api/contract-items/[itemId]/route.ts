import { authed, body } from "@/server/http/handler";
import { removeContractItem, setContractItemValue } from "@/modules/contracts/contracts.service";

/** Valor do item: { value } (só o diretor). */
export const PUT = authed<{ itemId: string }>(async ({ req, actor, params }) => setContractItemValue(actor, params.itemId, await body(req)));

export const DELETE = authed<{ itemId: string }>(({ actor, params }) => removeContractItem(actor, params.itemId));
