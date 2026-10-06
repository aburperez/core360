import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { roleDatabaseUrl, type DbRole } from "./urls";

/**
 * Três acessos ao banco, com papéis diferentes:
 *  - app:   papel "core_app" (sem BYPASSRLS). Usado por TODA requisição de usuário,
 *           sempre dentro de withUser() (src/server/db/with-user.ts).
 *  - auth:  papel "core_auth". Só login, sessão e convites; enxerga apenas identidade.
 *  - worker: papel "core_worker". Só o despacho de avisos: lê chamados e pessoas,
 *           grava avisos e envios. Não lê sessões, senhas nem fotos.
 *  - owner: dono das tabelas. Só migrations e seed.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const cache = globalThis as unknown as { appPrisma?: PrismaClient; authPrisma?: PrismaClient; workerPrisma?: PrismaClient };

function required(role: DbRole): string {
  const v = roleDatabaseUrl(role);
  if (!v) throw new Error(`Banco do papel ${role} não configurado (veja src/server/db/urls.ts)`);
  return v;
}

export function appPrisma(): PrismaClient {
  cache.appPrisma ??= createPrismaClient(required("app"));
  return cache.appPrisma;
}

export function authPrisma(): PrismaClient {
  cache.authPrisma ??= createPrismaClient(required("auth"));
  return cache.authPrisma;
}

export function workerPrisma(): PrismaClient {
  cache.workerPrisma ??= createPrismaClient(required("worker"));
  return cache.workerPrisma;
}
