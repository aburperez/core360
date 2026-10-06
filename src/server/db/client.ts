import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * Três acessos ao banco, com papéis diferentes:
 *  - app:   papel "core_app" (sem BYPASSRLS). Usado por TODA requisição de usuário,
 *           sempre dentro de withUser() (src/server/db/with-user.ts).
 *  - auth:  papel "core_auth". Só login, sessão e convites; enxerga apenas identidade.
 *  - owner: dono das tabelas. Só migrations e seed.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const cache = globalThis as unknown as { appPrisma?: PrismaClient; authPrisma?: PrismaClient };

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não definida`);
  return v;
}

export function appPrisma(): PrismaClient {
  cache.appPrisma ??= createPrismaClient(required("APP_DATABASE_URL"));
  return cache.appPrisma;
}

export function authPrisma(): PrismaClient {
  cache.authPrisma ??= createPrismaClient(required("AUTH_DATABASE_URL"));
  return cache.authPrisma;
}
