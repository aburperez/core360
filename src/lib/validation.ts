import { z } from "zod";
import { ValidationError } from "../server/errors";

export const uuid = z.uuid({ message: "ID inválido" });
export const text = (max = 200) => z.string().trim().min(1, "Obrigatório").max(max);
export const optionalText = (max = 2000) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/** Valida a entrada e devolve erro 422 com os campos problemáticos. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ValidationError("Dados inválidos", z.flattenError(r.error).fieldErrors);
  }
  return r.data;
}
