import { authed } from "@/server/http/handler";
import { startFromMatrixSections } from "@/modules/costs/costs.service";

/** Planilha vazia: cria as seções da matriz de orçamento. */
export const POST = authed<{ eventId: string }>(({ actor, params }) => startFromMatrixSections(actor, params.eventId), { status: 201 });
