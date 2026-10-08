import { authed } from "@/server/http/handler";
import { readUpload } from "@/server/http/upload-form";
import { MAX_ASSISTANT_BYTES, suggestPoints } from "@/modules/floorplans/assistant.service";

/** O assistente olha a planta e pode levar mais de um minuto. */
export const maxDuration = 300;

/** Sugestões de etapas do assistente (multipart: "file" com a imagem reduzida). Não grava nada. */
export const POST = authed<{ planId: string }>(async ({ req, actor, params }) => {
  const { file } = await readUpload(req, MAX_ASSISTANT_BYTES, "Imagem grande demais para o assistente");
  return suggestPoints(actor, params.planId, file?.bytes ?? null);
});
