import type { PrismaClient } from "../../generated/prisma/client";

export type Db = PrismaClient;
/** Cliente de transação: todo acesso a dados de negócio passa por aqui. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Executa `fn` numa transação em que o banco sabe quem é o usuário
 * (app.user_id). As políticas de RLS usam esse valor; sem ele, nada é visível.
 * `SET LOCAL` (terceiro argumento true) vale só para esta transação, então é
 * seguro com pool de conexões.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("userId inválido");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
