import { authed, body } from "@/server/http/handler";
import { setContractStatus } from "@/modules/contracts/contracts.service";

/** { action: "ENVIAR" | "RASCUNHO" | "ASSINAR" (signedOn) | "CANCELAR" (reason) }. */
export const POST = authed<{ contractId: string }>(async ({ req, actor, params }) => setContractStatus(actor, params.contractId, await body(req)));
