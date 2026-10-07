import { ValidationError } from "@/server/errors";

/** Formulário multipart com os campos em "data" (JSON) e o arquivo, opcional, em "file". */
export async function readUpload(req: Request, maxBytes: number, tooBig: string): Promise<{ input: unknown; file: { bytes: Uint8Array; name: string } | null }> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > maxBytes + 256 * 1024) throw new ValidationError(tooBig);
  const form = await req.formData().catch(() => null);
  if (!form) throw new ValidationError("Envie o formulário");
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
