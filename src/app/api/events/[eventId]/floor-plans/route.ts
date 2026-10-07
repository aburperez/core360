import { authed } from "@/server/http/handler";
import { readUpload } from "@/server/http/upload-form";
import { listPlans, MAX_PLAN_BYTES, uploadPlan } from "@/modules/floorplans/floorplans.service";

export const GET = authed<{ eventId: string }>(({ actor, params }) => listPlans(actor, params.eventId));

/** Nova planta (multipart: "data" com o nome e "file" com a imagem). */
export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => {
  const { input, file } = await readUpload(req, MAX_PLAN_BYTES, "Planta maior que 10 MB");
  return uploadPlan(actor, params.eventId, input, file?.bytes ?? null);
}, { status: 201 });
