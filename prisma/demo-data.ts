import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { ParticipantRole, Priority } from "../src/generated/prisma/enums";
import { DEFAULT_SLA_MINUTES } from "../src/modules/occurrences/sla";

export { DEFAULT_SLA_MINUTES };

/**
 * Cenário de demonstração do briefing (item 16) e base dos testes de segurança.
 *
 * Rock Festival 2027 (cliente Rock Produções)
 *   Infraestrutura: Elétrica (João, Carlos, Pedro), Estrutura (Marcos, Lucas), Cenografia (Ana, Bruno)
 *   A&B: Bar, Cozinha, Atendimento
 *   Pré-produção: Sofia (Pré-produtora, sem acesso ao campo)
 * Congresso Saúde 2027 (cliente Instituto Saúde) — "outro evento/cliente"
 *   Infraestrutura: Elétrica. João é HEAD aqui (mesma pessoa, papel diferente).
 */

type PersonKey =
  | "admin" | "marina" | "paulo" | "rafael" | "beatriz" | "claudia"
  | "joao" | "carlos" | "pedro" | "marcos" | "lucas" | "ana" | "bruno" | "inativo" | "sofia";

const PEOPLE: Record<PersonKey, { name: string; email: string; login: boolean; isAdmin?: boolean; active?: boolean }> = {
  admin:   { name: "Admin CORE 360", email: "admin@core360.dev", login: true, isAdmin: true },
  marina:  { name: "Marina Gerente", email: "marina@rockfestival.dev", login: true },
  paulo:   { name: "Paulo Gerente", email: "paulo@congresso.dev", login: true },
  rafael:  { name: "Rafael Head Infra", email: "rafael@rockfestival.dev", login: true },
  beatriz: { name: "Beatriz Head A&B", email: "beatriz@rockfestival.dev", login: true },
  claudia: { name: "Cláudia Cliente", email: "claudia@rockproducoes.dev", login: true },
  joao:    { name: "João", email: "joao@rockfestival.dev", login: true },
  carlos:  { name: "Carlos", email: "carlos@rockfestival.dev", login: true },
  pedro:   { name: "Pedro", email: "pedro@rockfestival.dev", login: true },
  // Marcos e Lucas foram cadastrados mas ainda não aceitaram o convite.
  marcos:  { name: "Marcos", email: "marcos@rockfestival.dev", login: false },
  lucas:   { name: "Lucas", email: "lucas@rockfestival.dev", login: false },
  ana:     { name: "Ana", email: "ana@rockfestival.dev", login: true },
  bruno:   { name: "Bruno", email: "bruno@rockfestival.dev", login: true },
  inativo: { name: "Usuário Inativo", email: "inativo@rockfestival.dev", login: true, active: false },
  // Pré-produtora: só a aba Pré-produção do Rock Festival.
  sofia:   { name: "Sofia Pré-produtora", email: "sofia@rockfestival.dev", login: true },
};

/** Senha das contas de demonstração (somente dev/teste). */
export const DEMO_PASSWORD = "core360-demo";

export async function seedDemo(db: PrismaClient) {
  const users = {} as Record<PersonKey, string | null>;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [key, p] of Object.entries(PEOPLE) as [PersonKey, (typeof PEOPLE)[PersonKey]][]) {
    if (!p.login) {
      users[key] = null;
      continue;
    }
    const u = await db.user.upsert({
      where: { email: p.email },
      update: {},
      create: { email: p.email, name: p.name, isAdmin: p.isAdmin ?? false, active: p.active ?? true, emailVerified: true },
    });
    users[key] = u.id;
    await db.account.upsert({
      where: { providerId_accountId: { providerId: "credential", accountId: u.id } },
      update: {},
      create: { userId: u.id, accountId: u.id, providerId: "credential", password: passwordHash },
    });
  }

  const rockClient = await db.client.create({
    data: { name: "Rock Produções", contactName: "Cláudia", email: "contato@rockproducoes.dev" },
  });
  const saudeClient = await db.client.create({
    data: { name: "Instituto Saúde", contactName: "Paulo", email: "contato@congresso.dev" },
  });

  const rock = await db.event.create({
    data: {
      clientId: rockClient.id,
      name: "Rock Festival 2027",
      startsAt: new Date("2027-04-10T12:00:00-03:00"),
      endsAt: new Date("2027-04-12T23:59:00-03:00"),
      venue: "Autódromo de Interlagos",
      address: "Av. Sen. Teotônio Vilela, 261 — São Paulo/SP",
      status: "MONTAGEM",
    },
  });
  const congresso = await db.event.create({
    data: {
      clientId: saudeClient.id,
      name: "Congresso Saúde 2027",
      startsAt: new Date("2027-06-01T08:00:00-03:00"),
      endsAt: new Date("2027-06-03T18:00:00-03:00"),
      venue: "Expo Center Norte",
      status: "PLANEJAMENTO",
    },
  });

  for (const ev of [rock, congresso]) {
    await db.slaPolicy.createMany({
      data: Object.entries(DEFAULT_SLA_MINUTES).map(([priority, targetMinutes]) => ({
        eventId: ev.id,
        priority: priority as Priority,
        targetMinutes,
      })),
    });
  }

  const area = (eventId: string, name: string) => db.area.create({ data: { eventId, name } });
  const team = (eventId: string, areaId: string, name: string) =>
    db.team.create({ data: { eventId, areaId, name } });

  const infra = await area(rock.id, "Infraestrutura");
  const ab = await area(rock.id, "A&B");
  const eletrica = await team(rock.id, infra.id, "Elétrica");
  const estrutura = await team(rock.id, infra.id, "Estrutura");
  const cenografia = await team(rock.id, infra.id, "Cenografia");
  const bar = await team(rock.id, ab.id, "Bar");
  const cozinha = await team(rock.id, ab.id, "Cozinha");
  const atendimento = await team(rock.id, ab.id, "Atendimento");

  const congressoInfra = await area(congresso.id, "Infraestrutura");
  const congressoEletrica = await team(congresso.id, congressoInfra.id, "Elétrica");

  const participant = async (
    eventId: string,
    key: PersonKey,
    role: ParticipantRole,
    opts: { areaId?: string; teamId?: string; jobTitle?: string; active?: boolean } = {},
  ) => {
    const p = PEOPLE[key];
    return db.participant.create({
      data: {
        eventId,
        userId: users[key],
        name: p.name,
        email: p.email,
        role,
        areaId: opts.areaId,
        teamId: opts.teamId,
        jobTitle: opts.jobTitle,
        active: opts.active ?? true,
        joinedAt: users[key] ? new Date() : null,
        invitedAt: new Date(),
        createdById: users.admin,
      },
    });
  };

  const parts = {
    marina: await participant(rock.id, "marina", "GERENTE", { jobTitle: "Gerente de projeto" }),
    claudia: await participant(rock.id, "claudia", "CLIENTE", { jobTitle: "Produtora (cliente)" }),
    sofia: await participant(rock.id, "sofia", "PRE_PRODUTOR", { jobTitle: "Pré-produtora" }),
    rafael: await participant(rock.id, "rafael", "HEAD", { areaId: infra.id, jobTitle: "Head de Infra" }),
    beatriz: await participant(rock.id, "beatriz", "HEAD", { areaId: ab.id, jobTitle: "Head de A&B" }),
    joao: await participant(rock.id, "joao", "OPERACIONAL", { areaId: infra.id, teamId: eletrica.id, jobTitle: "Eletricista" }),
    carlos: await participant(rock.id, "carlos", "OPERACIONAL", { areaId: infra.id, teamId: eletrica.id, jobTitle: "Técnico" }),
    pedro: await participant(rock.id, "pedro", "OPERACIONAL", { areaId: infra.id, teamId: eletrica.id, jobTitle: "Auxiliar" }),
    marcos: await participant(rock.id, "marcos", "OPERACIONAL", { areaId: infra.id, teamId: estrutura.id, jobTitle: "Montador" }),
    lucas: await participant(rock.id, "lucas", "OPERACIONAL", { areaId: infra.id, teamId: estrutura.id, jobTitle: "Montador" }),
    ana: await participant(rock.id, "ana", "OPERACIONAL", { areaId: infra.id, teamId: cenografia.id, jobTitle: "Coordenadora" }),
    bruno: await participant(rock.id, "bruno", "OPERACIONAL", { areaId: infra.id, teamId: cenografia.id, jobTitle: "Montador" }),
    inativo: await participant(rock.id, "inativo", "OPERACIONAL", { areaId: infra.id, teamId: eletrica.id, jobTitle: "Auxiliar" }),
    paulo: await participant(congresso.id, "paulo", "GERENTE", { jobTitle: "Gerente de projeto" }),
    joaoCongresso: await participant(congresso.id, "joao", "HEAD", { areaId: congressoInfra.id, jobTitle: "Head de Infra" }),
  };

  await db.team.update({ where: { id: cenografia.id }, data: { leaderParticipantId: parts.ana.id } });

  const occurrence = (data: {
    eventId: string; areaId: string; teamId: string; title: string;
    priority?: Priority; responsibleParticipantId?: string; createdById: string;
  }) => {
    const priority = data.priority ?? "NORMAL";
    const openedAt = new Date();
    return db.occurrence.create({
      data: {
        ...data,
        priority,
        clientId: rockClient.id, // sobrescrito pelo trigger a partir do evento
        openedAt,
        slaDueAt: new Date(openedAt.getTime() + DEFAULT_SLA_MINUTES[priority] * 60_000),
      },
    });
  };

  const occ = {
    quadroEletrico: await occurrence({
      eventId: rock.id, areaId: infra.id, teamId: eletrica.id,
      title: "Quadro elétrico do palco 2 desarmando", priority: "CRITICA",
      responsibleParticipantId: parts.joao.id, createdById: users.rafael!,
    }),
    painelCenografia: await occurrence({
      eventId: rock.id, areaId: infra.id, teamId: cenografia.id,
      title: "Painel de LED da cenografia sem fixação", priority: "ALTA",
      responsibleParticipantId: parts.ana.id, createdById: users.rafael!,
    }),
    chopeira: await occurrence({
      eventId: rock.id, areaId: ab.id, teamId: bar.id,
      title: "Chopeira do bar 3 sem pressão", priority: "NORMAL", createdById: users.beatriz!,
    }),
    congressoTomada: await occurrence({
      eventId: congresso.id, areaId: congressoInfra.id, teamId: congressoEletrica.id,
      title: "Tomadas do auditório B sem energia", priority: "ALTA", createdById: users.paulo!,
    }),
  };

  return {
    users,
    clients: { rock: rockClient, saude: saudeClient },
    events: { rock, congresso },
    areas: { infra, ab, congressoInfra },
    teams: { eletrica, estrutura, cenografia, bar, cozinha, atendimento, congressoEletrica },
    participants: parts,
    occurrences: occ,
  };
}

export type DemoData = Awaited<ReturnType<typeof seedDemo>>;
