import { authed, body } from "@/server/http/handler";
import { createContract, listContracts } from "@/modules/contracts/contracts.service";

/** Contratos do evento (Pré-produção). */
export const GET = authed<{ eventId: string }>(({ actor, params }) => listContracts(actor, params.eventId));

/** Novo contrato para um fornecedor: { supplierId }. */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => createContract(actor, params.eventId, await body(req)), { status: 201 });
