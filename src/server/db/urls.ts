import { createHmac } from "node:crypto";

/**
 * Endereço do banco para cada papel. Em dev/teste cada um vem da sua variável
 * (APP_DATABASE_URL, AUTH_DATABASE_URL, WORKER_DATABASE_URL). Na hospedagem
 * (Vercel + Neon) basta o DATABASE_URL do dono: os outros são montados com o
 * mesmo servidor e uma senha própria de cada papel, derivada de DB_ROLES_SECRET
 * (ou de BETTER_AUTH_SECRET). Quem cria os papéis é scripts/deploy-db.ts.
 */
export const DB_ROLES = { app: "core_app", auth: "core_auth", worker: "core_worker" } as const;
export type DbRole = keyof typeof DB_ROLES;

const EXPLICIT: Record<DbRole, string> = {
  app: "APP_DATABASE_URL",
  auth: "AUTH_DATABASE_URL",
  worker: "WORKER_DATABASE_URL",
};

function rolesSecret() {
  const s = process.env.DB_ROLES_SECRET || process.env.BETTER_AUTH_SECRET;
  return s && s.length >= 32 ? s : null;
}

/** Senha do papel no banco. Muda se o segredo mudar; o deploy-db reaplica. */
export function rolePassword(role: DbRole): string {
  const secret = rolesSecret();
  if (!secret) throw new Error("Defina DB_ROLES_SECRET ou BETTER_AUTH_SECRET (mínimo 32 caracteres)");
  return createHmac("sha256", secret).update(`core360-db-role:${DB_ROLES[role]}`).digest("base64url");
}

export function roleDatabaseUrl(role: DbRole): string | null {
  const explicit = process.env[EXPLICIT[role]];
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base || !rolesSecret()) return null;
  const url = new URL(base);
  url.username = DB_ROLES[role];
  url.password = rolePassword(role);
  return url.toString();
}

/** Conexão direta (sem pooler) para migrations. O Neon na Vercel cria as duas. */
export function ownerDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
}
