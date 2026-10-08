import { authed, body } from "@/server/http/handler";
import { getContract, updateContract } from "@/modules/contracts/contracts.service";

export const GET = authed<{ contractId: string }>(({ actor, params }) => getContract(actor, params.contractId));

/** Condição de pagamento, datas de entrega e observações (rascunho). */
export const PATCH = authed<{ contractId: string }>(async ({ req, actor, params }) => updateContract(actor, params.contractId, await body(req)));
