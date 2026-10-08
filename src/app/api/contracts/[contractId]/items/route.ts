import { authed, body } from "@/server/http/handler";
import { addContractItem } from "@/modules/contracts/contracts.service";

/** Inclui uma proposta aprovada do fornecedor: { quoteId }. */
export const POST = authed<{ contractId: string }>(async ({ req, actor, params }) => addContractItem(actor, params.contractId, await body(req)), { status: 201 });
