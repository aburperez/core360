import { maxDocumentBytes } from "@/modules/documents/file";
import { formatBytes } from "@/lib/documents";
import type { PlanFile } from "@/modules/items/plan-reading.service";
import { ValidationError } from "@/server/errors";

/** Leitor de planta (multipart): os campos em "data" (JSON) e a planta, opcional, em "file". */
export async function readPlanForm(req: Request): Promise<{ input: unknown; file: PlanFile | null }> {
  const max = maxDocumentBytes();
  if (Number(req.headers.get("content-length") ?? 0) > max + 256 * 1024) throw new ValidationError(`Arquivo maior que ${formatBytes(max)}`);
  const form = await req.formData().catch(() => null);
  if (!form) throw new ValidationError("Envie a planta");
  let input: unknown = {};
  try {
    input = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    throw new ValidationError("Dados inválidos");
  }
  const f = form.get("file");
  const file = f instanceof File && f.size > 0 ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null;
  return { input, file };
}
