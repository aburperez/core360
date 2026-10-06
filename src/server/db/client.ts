import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * Dois acessos ao banco, com papéis diferentes:
 *  - app:   papel "core_app" (sem BYPASSRLS). Usado por TODA requisição de usuário.
 *  - owner: dono das tabelas. Só para migrations, seed e tarefas administrativas.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { appPrisma?: PrismaClient };

export function appPrisma(): PrismaClient {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new Error("APP_DATABASE_URL não definida");
  globalForPrisma.appPrisma ??= createPrismaClient(url);
  return globalForPrisma.appPrisma;
}
