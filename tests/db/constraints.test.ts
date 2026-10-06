import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appDb, demo, expectPgError, ownerDb } from "../helpers";
import type { DemoData } from "../../prisma/demo-data";

// Estes testes rodam como DONO das tabelas, de propósito: provam que as regras
// valem no banco mesmo que o código da aplicação esteja errado.

const FK = "23503";
const CHECK = "23514";
const UNIQUE = "23505";
const BAD_ENUM = "22P02";
const DENIED = "42501";

const db = ownerDb();
let d: DemoData;

beforeAll(async () => {
  d = await demo(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("hierarquia cliente → evento → área → equipe", () => {
  it("recusa equipe apontando para área de OUTRO evento", async () => {
    await expectPgError(
      db.team.create({
        data: { eventId: d.events.rock.id, areaId: d.areas.congressoInfra.id, name: "Equipe intrusa" },
      }),
      FK,
    );
  });

  it("recusa área com nome repetido no mesmo evento, sem diferenciar maiúsculas", async () => {
    await expectPgError(db.area.create({ data: { eventId: d.events.rock.id, name: "INFRAESTRUTURA" } }), UNIQUE);
  });

  it("permite o mesmo nome de área em outro evento", async () => {
    const a = await db.area.create({ data: { eventId: d.events.congresso.id, name: "A&B" } });
    expect(a.eventId).toBe(d.events.congresso.id);
  });
});

describe("participantes e papéis", () => {
  const base = () => ({ eventId: d.events.rock.id, name: "Novo", email: `novo${Math.random()}@x.dev` });

  it("não existe papel ADMIN por evento", async () => {
    await expectPgError(
      db.$executeRaw`INSERT INTO participants (id, event_id, name, email, role, updated_at)
                     VALUES (gen_random_uuid(), ${d.events.rock.id}::uuid, 'X', 'x@x.dev', 'ADMIN', now())`,
      BAD_ENUM,
    );
  });

  it("OPERACIONAL exige área e equipe", async () => {
    await expectPgError(
      db.participant.create({ data: { ...base(), role: "OPERACIONAL", areaId: d.areas.infra.id } }),
      CHECK,
    );
  });

  it("HEAD exige área", async () => {
    await expectPgError(db.participant.create({ data: { ...base(), role: "HEAD" } }), CHECK);
  });

  it("recusa equipe sem área (a FK composta não cobriria esse caso)", async () => {
    await expectPgError(
      db.participant.create({ data: { ...base(), role: "CLIENTE", teamId: d.teams.eletrica.id } }),
      CHECK,
    );
  });

  it("recusa equipe que não pertence à área informada", async () => {
    await expectPgError(
      db.participant.create({
        data: { ...base(), role: "OPERACIONAL", areaId: d.areas.ab.id, teamId: d.teams.eletrica.id },
      }),
      FK,
    );
  });

  it("recusa o mesmo e-mail duas vezes no mesmo evento (sem diferenciar maiúsculas)", async () => {
    await expectPgError(
      db.participant.create({
        data: { eventId: d.events.rock.id, name: "João de novo", email: "JOAO@rockfestival.dev", role: "CLIENTE" },
      }),
      UNIQUE,
    );
  });

  it("a mesma pessoa pode ter papéis diferentes em eventos diferentes", async () => {
    const joao = await db.participant.findMany({ where: { userId: d.users.joao! }, orderBy: { role: "asc" } });
    expect(joao.map((p) => p.role).sort()).toEqual(["HEAD", "OPERACIONAL"]);
    expect(new Set(joao.map((p) => p.eventId)).size).toBe(2);
  });
});

describe("ocorrências", () => {
  const rockOcc = () => ({
    eventId: d.events.rock.id,
    areaId: d.areas.infra.id,
    teamId: d.teams.eletrica.id,
    title: "Teste",
    createdById: d.users.rafael!,
    clientId: d.clients.rock.id,
  });

  it("recusa equipe de outra área/evento", async () => {
    await expectPgError(db.occurrence.create({ data: { ...rockOcc(), teamId: d.teams.bar.id } }), FK);
    await expectPgError(
      db.occurrence.create({ data: { ...rockOcc(), teamId: d.teams.congressoEletrica.id } }),
      FK,
    );
  });

  it("recusa responsável que é participante de outro evento", async () => {
    await expectPgError(
      db.occurrence.create({ data: { ...rockOcc(), responsibleParticipantId: d.participants.paulo.id } }),
      FK,
    );
  });

  it("numera por evento e ignora client_id enviado de fora", async () => {
    const o = await db.occurrence.create({
      data: { ...rockOcc(), clientId: d.clients.saude.id, number: 999 },
    });
    expect(o.clientId).toBe(d.clients.rock.id);
    expect(o.number).toBeGreaterThan(3);
    expect(o.number).not.toBe(999);
    expect(o.version).toBe(1);
  });

  it("não permite mover a ocorrência para outro evento nem trocar o número", async () => {
    const o = await db.occurrence.create({ data: rockOcc() });
    await expectPgError(
      db.occurrence.update({ where: { id: o.id }, data: { number: o.number + 100 } }),
      CHECK,
    );
    await expectPgError(
      db.occurrence.update({ where: { id: o.id }, data: { openedAt: new Date(0) } }),
      CHECK,
    );
  });

  it("concluir exige horário e quem concluiu; duração e SLA são calculados pelo banco", async () => {
    const openedAt = new Date(Date.now() - 30 * 60_000);
    const o = await db.occurrence.create({
      data: { ...rockOcc(), openedAt, slaDueAt: new Date(openedAt.getTime() + 15 * 60_000) },
    });

    await expectPgError(
      db.occurrence.update({ where: { id: o.id }, data: { status: "CONCLUIDO" } }),
      CHECK,
    );

    const concludedAt = new Date(openedAt.getTime() + 20 * 60_000);
    const done = await db.occurrence.update({
      where: { id: o.id },
      data: { status: "CONCLUIDO", concludedAt, concludedById: d.users.joao!, durationSeconds: 1 },
    });
    expect(done.durationSeconds).toBe(20 * 60);
    expect(done.slaBreached).toBe(true);
    expect(done.version).toBe(2);
  });

  it("dentro do prazo não estoura o SLA", async () => {
    const openedAt = new Date(Date.now() - 10 * 60_000);
    const o = await db.occurrence.create({
      data: { ...rockOcc(), openedAt, slaDueAt: new Date(openedAt.getTime() + 60 * 60_000) },
    });
    const done = await db.occurrence.update({
      where: { id: o.id },
      data: { status: "CONCLUIDO", concludedAt: new Date(), concludedById: d.users.joao! },
    });
    expect(done.slaBreached).toBe(false);
  });

  it("conclusão antes da abertura é recusada", async () => {
    const o = await db.occurrence.create({ data: rockOcc() });
    await expectPgError(
      db.occurrence.update({
        where: { id: o.id },
        data: { status: "CONCLUIDO", concludedAt: new Date(o.openedAt.getTime() - 1000), concludedById: d.users.joao! },
      }),
      CHECK,
    );
  });
});

describe("evidências", () => {
  it("recusa arquivo que não é imagem e evidência de ocorrência de outro evento", async () => {
    const base = {
      occurrenceId: d.occurrences.quadroEletrico.id,
      eventId: d.events.rock.id,
      storageKey: `t/${Math.random()}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      sha256: "a".repeat(64),
      uploadedById: d.users.joao!,
    };
    await expectPgError(db.attachment.create({ data: { ...base, mimeType: "application/pdf" } }), CHECK);
    await expectPgError(
      db.attachment.create({ data: { ...base, eventId: d.events.congresso.id } }),
      FK,
    );
    const ok = await db.attachment.create({ data: base });
    expect(ok.id).toBeTruthy();
  });
});

describe("auditoria imutável", () => {
  it("bloqueia UPDATE e DELETE no audit_log, até para o dono das tabelas", async () => {
    const row = await db.auditLog.create({
      data: { entity: "occurrence", entityId: d.occurrences.quadroEletrico.id, action: "CREATE", actorUserId: d.users.rafael },
    });
    await expectPgError(db.auditLog.update({ where: { id: row.id }, data: { action: "DELETE" } }), DENIED);
    await expectPgError(db.auditLog.delete({ where: { id: row.id } }), DENIED);
    await expectPgError(db.$executeRawUnsafe("TRUNCATE audit_log"), DENIED);
  });
});

describe("papel da aplicação (core_app)", () => {
  const app = appDb();
  afterAll(() => app.$disconnect());

  it("não consegue apagar dados de negócio (exclusão é só lógica)", async () => {
    await expectPgError(
      app.occurrence.delete({ where: { id: d.occurrences.chopeira.id } }),
      DENIED,
    );
    await expectPgError(app.participant.deleteMany({ where: { eventId: d.events.rock.id } }), DENIED);
  });

  it("não consegue alterar a auditoria", async () => {
    await expectPgError(app.$executeRawUnsafe("UPDATE audit_log SET action = 'DELETE'"), DENIED);
  });

  it("consegue abrir ocorrência (trigger de numeração roda com privilégio próprio)", async () => {
    const o = await app.occurrence.create({
      data: {
        eventId: d.events.rock.id, areaId: d.areas.ab.id, teamId: d.teams.cozinha.id,
        title: "Fogão industrial sem gás", createdById: d.users.beatriz!, clientId: d.clients.rock.id,
      },
    });
    expect(o.number).toBeGreaterThan(0);
  });

  it("não é dono das tabelas e não ignora RLS", async () => {
    const [r] = await app.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(r).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await app.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(Number(owned[0].n)).toBe(0);
  });
});
