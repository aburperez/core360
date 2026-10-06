import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { Priority } from "../src/generated/prisma/enums";
import { DEFAULT_SLA_MINUTES } from "../src/modules/occurrences/sla";

/**
 * Ambiente de teste de usabilidade: a conta do Admin e o evento de treino
 * "Teste de usabilidade", com áreas, equipes e alguns chamados abertos para as
 * tarefas do roteiro. Pode rodar a cada deploy: só cria o que não existe e
 * nunca troca a senha de quem já tem conta.
 */
export const TRAINING_EVENT = "Teste de usabilidade";

export async function seedTraining(
  db: PrismaClient,
  admin: { email: string; password: string; name?: string },
): Promise<{ adminCreated: boolean; eventCreated: boolean }> {
  const email = admin.email.trim().toLowerCase();
  let adminCreated = false;
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    if (admin.password.length < 10) throw new Error("ADMIN_PASSWORD precisa de pelo menos 10 caracteres");
    user = await db.user.create({
      data: { email, name: admin.name || "Admin", isAdmin: true, active: true, emailVerified: true },
    });
    await db.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(admin.password) },
    });
    adminCreated = true;
  } else if (!user.isAdmin || !user.active) {
    user = await db.user.update({ where: { id: user.id }, data: { isAdmin: true, active: true } });
  }

  if (await db.event.findFirst({ where: { name: TRAINING_EVENT, deletedAt: null } })) {
    return { adminCreated, eventCreated: false };
  }

  const client = await db.client.create({ data: { name: "Cliente de teste", contactName: "Equipe do teste" } });
  const now = new Date();
  const event = await db.event.create({
    data: {
      clientId: client.id,
      name: TRAINING_EVENT,
      description: "Evento de treino para o teste de usabilidade. Pode ser apagado depois.",
      startsAt: now,
      endsAt: new Date(now.getTime() + 60 * 24 * 60 * 60_000),
      venue: "Local do teste",
      status: "OPERACAO",
    },
  });
  await db.slaPolicy.createMany({
    data: Object.entries(DEFAULT_SLA_MINUTES).map(([priority, targetMinutes]) => ({
      eventId: event.id, priority: priority as Priority, targetMinutes,
    })),
  });

  const area = (name: string) => db.area.create({ data: { eventId: event.id, name } });
  const team = (areaId: string, name: string) => db.team.create({ data: { eventId: event.id, areaId, name } });
  const infra = await area("Infraestrutura");
  const palco = await area("Palco");
  const eletrica = await team(infra.id, "Elétrica");
  await team(infra.id, "Limpeza");
  const cenografia = await team(palco.id, "Cenografia");

  const occurrence = (areaId: string, teamId: string, title: string, priority: Priority) => {
    const openedAt = new Date();
    return db.occurrence.create({
      data: {
        eventId: event.id, clientId: client.id, areaId, teamId, title, priority, createdById: user.id, openedAt,
        slaDueAt: new Date(openedAt.getTime() + DEFAULT_SLA_MINUTES[priority] * 60_000),
      },
    });
  };
  await occurrence(infra.id, eletrica.id, "Tomada do camarim 1 sem energia", "NORMAL");
  await occurrence(infra.id, eletrica.id, "Refletor da entrada piscando", "BAIXA");
  await occurrence(palco.id, cenografia.id, "Painel do fundo do palco solto", "ALTA");

  return { adminCreated, eventCreated: true };
}
