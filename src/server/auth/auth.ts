import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";
import { isIP } from "node:net";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPrisma } from "../db/client";
import { publicUrl } from "../../lib/public-url";
import { getMailer, resetPasswordEmail, type Mailer } from "../email/email";

export const MIN_PASSWORD_LENGTH = 8;

export interface AuthConfig {
  db: PrismaClient;
  secret: string;
  baseURL: string;
  /** Outros endereços do mesmo app que podem fazer login (ex.: domínios da Vercel). */
  trustedOrigins?: string[];
  /** Limite de tentativas de login (desligar só em testes unitários específicos). */
  rateLimit?: boolean;
  /** Endereço fixo do app nos links do e-mail (nunca o Host do pedido, que quem pede escolhe). */
  appUrl?: string;
  /** Quem envia o e-mail; null = envio desligado. Padrão: o do ambiente (src/server/email). */
  mailer?: () => Mailer | null;
  /**
   * Roda o envio depois da resposta (na Vercel, `after`), para a resposta não
   * demorar mais quando o e-mail existe. Padrão: espera o envio (testes).
   */
  defer?: (task: () => Promise<void>) => void | Promise<void>;
}

/** O link do e-mail vale 1 hora. */
export const RESET_TOKEN_SECONDS = 60 * 60;

/**
 * Login com Better Auth. Usa a conexão "core_auth", que só enxerga tabelas de
 * identidade. Não há cadastro público: contas nascem pelo convite
 * (src/server/auth/invitations.ts).
 */
export function createAuth(cfg: AuthConfig) {
  const db = cfg.db;

  async function logLogin(userId: string | null, action: "LOGIN" | "LOGIN_DENIED" | "PASSWORD_RESET", ip?: string | null, ua?: string | null) {
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
    // Além da lista fixa, o próprio endereço por onde o pedido chegou: a Vercel só
    // entrega aqui os domínios deste projeto (o .vercel.app e o domínio próprio),
    // e um site de fora nunca consegue mandar o Origin igual ao nosso endereço.
    trustedOrigins: (request) => [...(cfg.trustedOrigins ?? []), ...(request ? [new URL(request.url).origin] : [])],
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      // "Esqueci minha senha": o link vale 1 hora e uma vez só; trocar a senha
      // derruba as sessões em todos os aparelhos. A resposta é sempre a mesma,
      // exista o e-mail ou não.
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      sendResetPassword: async ({ user, token }) => {
        // Conta desativada não recebe o link (e não descobre que está desativada).
        const u = await db.user.findUnique({ where: { id: user.id }, select: { active: true, name: true, email: true } });
        const mailer = (cfg.mailer ?? getMailer)();
        if (!u?.active || !mailer) return;
        const url = `${(cfg.appUrl ?? cfg.baseURL).replace(/\/$/, "")}/redefinir-senha?token=${encodeURIComponent(token)}`;
        const task = () =>
          mailer.send(resetPasswordEmail({ to: u.email, name: u.name, url })).catch((err) => {
            console.error("Esqueci minha senha: e-mail não enviado", err);
          });
        await (cfg.defer ?? ((t) => t()))(task);
      },
      onPasswordReset: async ({ user }, request) => {
        const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request?.headers.get("x-real-ip");
        await logLogin(user.id, "PASSWORD_RESET", ip, request?.headers.get("user-agent"));
      },
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
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
    advanced: {
      database: { generateId: false }, // UUID gerado pelo Prisma/banco
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
      // Igual à produção também nos testes (lá o Better Auth desligaria sozinho).
      disableOriginCheck: false,
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
      appUrl: publicUrl(),
      // Na Vercel, o e-mail sai depois da resposta (a função continua viva até terminar).
      defer: (task) => after(task),
      // Na Vercel o mesmo app responde no domínio de produção e no endereço do deploy.
      trustedOrigins: [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
        .filter((h): h is string => !!h)
        .map((h) => `https://${h}`),
    });
  }
  return cache.auth;
}
