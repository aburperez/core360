import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { isIP } from "node:net";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPrisma } from "../db/client";
import { publicUrl } from "../../lib/public-url";

export const MIN_PASSWORD_LENGTH = 8;

export interface AuthConfig {
  db: PrismaClient;
  secret: string;
  baseURL: string;
  /** Outros endereços do mesmo app que podem fazer login (ex.: domínios da Vercel). */
  trustedOrigins?: string[];
  /** Limite de tentativas de login (desligar só em testes unitários específicos). */
  rateLimit?: boolean;
}

/**
 * Login com Better Auth. Usa a conexão "core_auth", que só enxerga tabelas de
 * identidade. Não há cadastro público: contas nascem pelo convite
 * (src/server/auth/invitations.ts).
 */
export function createAuth(cfg: AuthConfig) {
  const db = cfg.db;

  async function logLogin(userId: string | null, action: "LOGIN" | "LOGIN_DENIED", ip?: string | null, ua?: string | null) {
    // createMany não usa RETURNING: core_auth grava na auditoria mas não lê.
    await db.auditLog.createMany({
      data: {
        actorUserId: userId,
        entity: "user",
        entityId: userId,
        action,
        ip: ip && isIP(ip) ? ip : null,
        userAgent: ua?.slice(0, 500) ?? null,
      },
    });
  }

  return betterAuth({
    appName: "CORE 360",
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    trustedOrigins: cfg.trustedOrigins,
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        // input: false → nunca aceitos do navegador.
        isAdmin: { type: "boolean", defaultValue: false, input: false },
        active: { type: "boolean", defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 dias
      updateAge: 60 * 60 * 24, // renova a cada dia de uso
      // Sem cache em cookie: cada requisição relê a sessão no banco, então
      // desativar um usuário tem efeito imediato.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: cfg.rateLimit ?? true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
    advanced: {
      database: { generateId: false }, // UUID gerado pelo Prisma/banco
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
    },
    databaseHooks: {
      session: {
        create: {
          // Usuário inativo não recebe sessão, mesmo com senha correta.
          before: async (session, ctx) => {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { active: true } });
            const ip = session.ipAddress ?? null;
            const ua = session.userAgent ?? ctx?.headers?.get("user-agent") ?? null;
            if (!user?.active) {
              await logLogin(session.userId, "LOGIN_DENIED", ip, ua);
              return false;
            }
            await logLogin(session.userId, "LOGIN", ip, ua);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = globalThis as unknown as { auth?: Auth };

export function getAuth(): Auth {
  if (!cache.auth) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET ausente ou curta (mínimo 32 caracteres)");
    cache.auth = createAuth({
      db: authPrisma(),
      secret,
      baseURL: process.env.BETTER_AUTH_URL || publicUrl(),
      // Na Vercel o mesmo app responde no domínio de produção e no endereço do deploy.
      trustedOrigins: [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
        .filter((h): h is string => !!h)
        .map((h) => `https://${h}`),
    });
  }
  return cache.auth;
}
