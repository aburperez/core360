import { authed } from "@/server/http/handler";
import { readPlanForm } from "@/server/http/plan-form";
import { addPlanItems } from "@/modules/items/plan-reading.service";

/** Os itens conferidos da planta entram na planilha (multipart "data"; "file" só para guardar nos Documentos). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const { input, file } = await readPlanForm(req);
  return addPlanItems(actor, params.eventId, input, file);
}, { status: 201 });
