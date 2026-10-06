/** SQLSTATE do Postgres por trás de um erro do Prisma/adapter, se houver. */
export function pgErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const walk = (e: unknown): string | undefined => {
    if (!e || typeof e !== "object" || seen.has(e)) return undefined;
    seen.add(e);
    const o = e as Record<string, unknown>;
    if (typeof o.originalCode === "string") return o.originalCode;
    for (const v of Object.values(o)) {
      const r = walk(v);
      if (r) return r;
    }
    return undefined;
  };
  const found = walk(err);
  if (found) return found;
  const code = (err as { code?: unknown })?.code;
  return code === "P2002" ? "23505" : code === "P2003" ? "23503" : typeof code === "string" ? code : undefined;
}

export const isUniqueViolation = (e: unknown) => pgErrorCode(e) === "23505";
/** Política de RLS recusou a escrita (WITH CHECK) ou falta GRANT. */
export const isRlsViolation = (e: unknown) => pgErrorCode(e) === "42501";
