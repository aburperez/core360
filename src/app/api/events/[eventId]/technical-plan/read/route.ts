import { authed } from "@/server/http/handler";
import { readPlanForm } from "@/server/http/plan-form";
import { readTechnicalPlan } from "@/modules/items/plan-reading.service";

/** A IA lê a planta técnica (multipart "file", "data" com a área) e devolve os itens. Não salva nada. */
export const maxDuration = 120;

export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const { input, file } = await readPlanForm(req);
  return readTechnicalPlan(actor, params.eventId, file, input);
});
