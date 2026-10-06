import { inject } from "vitest";
import { createPrismaClient } from "@/server/db/client";
import { seedDemo, type DemoData } from "../prisma/demo-data";

export const ownerDb = () => createPrismaClient(inject("ownerUrl"));
export const appDb = () => createPrismaClient(inject("appUrl"));

let cached: DemoData | undefined;

/** Seed de demonstração, criado uma vez por arquivo de teste. */
export async function demo(db: ReturnType<typeof ownerDb>): Promise<DemoData> {
  cached ??= await seedDemo(db);
  return cached;
}

/** Prisma converte alguns erros do Postgres em códigos próprios. */
const PRISMA_TO_SQLSTATE: Record<string, string> = { P2002: "23505", P2003: "23503" };

/** SQLSTATE do Postgres por trás de um erro do Prisma/adapter, se houver. */
export function pgCode(err: unknown): string | undefined {
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
  const code = (err as { code?: unknown })?.code;
  return walk(err) ?? (typeof code === "string" ? PRISMA_TO_SQLSTATE[code] ?? code : undefined);
}

/** Espera que a promessa falhe com o SQLSTATE informado. */
export async function expectPgError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    const got = pgCode(err);
    if (got !== code) {
      throw new Error(`esperava SQLSTATE ${code}, recebi ${got ?? "nenhum"}: ${String(err)}`);
    }
    return;
  }
  throw new Error(`esperava falha com SQLSTATE ${code}, mas a operação foi aceita`);
}
