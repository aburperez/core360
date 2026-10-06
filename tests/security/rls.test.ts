import { afterAll, describe, expect, it } from "vitest";
import { appDb, demo, expectPgError, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";

/**
 * Os mesmos cenários, mas DIRETO no banco, como core_app e SEM nenhum filtro
 * do backend: simula um bug no código (consulta sem WHERE). A RLS tem que
 * segurar sozinha.
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const RLS = "42501";

describe("sem usuário definido (falha fechada)", () => {
  it("não vê nada", async () => {
    await db.$transaction(async (tx) => {
      expect(await tx.event.count()).toBe(0);
      expect(await tx.occurrence.count()).toBe(0);
      expect(await tx.participant.count()).toBe(0);
      expect(await tx.user.count()).toBe(0);
    });
  });
});

describe("Gerente", () => {
  it("vê o próprio evento inteiro e nada do outro (cenários 1 e 2)", async () => {
    await as("marina", async (tx) => {
      const events = await tx.event.findMany({ select: { id: true } });
      expect(events.map((e) => e.id)).toEqual([d.events.rock.id]);
      expect(await tx.occurrence.count({ where: { eventId: d.events.congresso.id } })).toBe(0);
      expect(await tx.occurrence.count({ where: { areaId: d.areas.ab.id } })).toBeGreaterThan(0);
      expect(await tx.occurrence.count({ where: { areaId: d.areas.infra.id } })).toBeGreaterThan(0);
      expect(await tx.participant.count({ where: { eventId: d.events.congresso.id } })).toBe(0);
      expect(await tx.client.count({ where: { id: d.clients.saude.id } })).toBe(0);
    });
  });
});

describe("Head de Infra", () => {
  it("vê toda a Infra e nada interno de A&B (cenários 3 e 4)", async () => {
    await as("rafael", async (tx) => {
      expect(await tx.occurrence.count({ where: { areaId: d.areas.infra.id } })).toBeGreaterThanOrEqual(2);
      expect(await tx.occurrence.count({ where: { areaId: d.areas.ab.id } })).toBe(0);
      expect(await tx.team.count({ where: { areaId: d.areas.ab.id } })).toBe(0);
      expect(await tx.participant.count({ where: { areaId: d.areas.ab.id } })).toBe(0);
    });
  });

  it("não grava ocorrência em A&B nem como outra pessoa", async () => {
    await expectPgError(
      as("rafael", (tx) =>
        tx.occurrence.create({
          data: {
            eventId: d.events.rock.id, areaId: d.areas.ab.id, teamId: d.teams.bar.id,
            title: "Intrusa", createdById: d.users.rafael!, clientId: d.clients.rock.id,
          },
        }),
      ),
      RLS,
    );
    await expectPgError(
      as("rafael", (tx) =>
        tx.occurrence.create({
          data: {
            eventId: d.events.rock.id, areaId: d.areas.infra.id, teamId: d.teams.eletrica.id,
            title: "Em nome de outro", createdById: d.users.marina!, clientId: d.clients.rock.id,
          },
        }),
      ),
      RLS,
    );
  });

  it("não move ocorrência da Infra para A&B", async () => {
    await expectPgError(
      as("rafael", (tx) =>
        tx.occurrence.update({
          where: { id: d.occurrences.quadroEletrico.id },
          data: { areaId: d.areas.ab.id, teamId: d.teams.bar.id },
        }),
      ),
      RLS,
    );
  });
});

describe("Operacional da Elétrica", () => {
  it("vê só a própria equipe (cenários 5 e 6)", async () => {
    await as("joao", async (tx) => {
      const occ = await tx.occurrence.findMany({ where: { eventId: d.events.rock.id }, select: { teamId: true, responsibleParticipantId: true } });
      expect(occ.length).toBeGreaterThan(0);
      for (const o of occ) {
        expect(o.teamId === d.teams.eletrica.id || o.responsibleParticipantId === d.participants.joao.id).toBe(true);
      }
      expect(await tx.occurrence.count({ where: { teamId: d.teams.cenografia.id } })).toBe(0);
      expect(await tx.participant.count({ where: { teamId: d.teams.cenografia.id } })).toBe(0);
      expect(await tx.team.findMany({ where: { eventId: d.events.rock.id }, select: { id: true } })).toEqual([
        { id: d.teams.eletrica.id },
      ]);
      expect(await tx.area.count({ where: { id: d.areas.ab.id } })).toBe(0);
    });
  });

  it("não altera o próprio papel direto no banco", async () => {
    const changed = await as("joao", (tx) =>
      tx.participant.updateMany({ where: { id: d.participants.joao.id }, data: { role: "GERENTE" } }),
    );
    expect(changed.count).toBe(0);
  });

  it("não consegue ligar uma participação à própria conta", async () => {
    await expectPgError(
      as("joao", (tx) => tx.$executeRaw`UPDATE participants SET user_id = ${d.users.joao!}::uuid WHERE id = ${d.participants.marcos.id}::uuid`),
      RLS,
    );
  });
});

describe("Cliente", () => {
  it("cadastra Operacional mas não Gerente/Head, e não vê ocorrências (cenários 7 e 8)", async () => {
    const base = { eventId: d.events.rock.id, name: "Via SQL", createdById: d.users.claudia! };
    await as("claudia", async (tx) => {
      const ok = await tx.participant.create({
        data: { ...base, email: `sql-${Date.now()}@x.dev`, role: "OPERACIONAL", areaId: d.areas.infra.id, teamId: d.teams.eletrica.id },
      });
      expect(ok.id).toBeTruthy();
      expect(await tx.occurrence.count()).toBe(0);
    });
    await expectPgError(
      as("claudia", (tx) => tx.participant.create({ data: { ...base, email: `g-${Date.now()}@x.dev`, role: "GERENTE" } })),
      RLS,
    );
    await expectPgError(
      as("claudia", (tx) =>
        tx.participant.create({ data: { ...base, email: `h-${Date.now()}@x.dev`, role: "HEAD", areaId: d.areas.infra.id } }),
      ),
      RLS,
    );
  });

  it("não se torna admin nem cria usuários", async () => {
    const changed = await as("claudia", (tx) =>
      tx.user.updateMany({ where: { id: d.users.claudia! }, data: { isAdmin: true } }),
    );
    expect(changed.count).toBe(0);
    await expectPgError(
      as("claudia", (tx) => tx.user.create({ data: { email: `u-${Date.now()}@x.dev`, name: "U", isAdmin: true } })),
      RLS,
    );
  });
});

describe("Usuário inativo (cenário 9)", () => {
  it("mesmo com app.user_id definido, não vê nada", async () => {
    await as("inativo", async (tx) => {
      expect(await tx.event.count()).toBe(0);
      expect(await tx.occurrence.count()).toBe(0);
      expect(await tx.team.count()).toBe(0);
    });
  });
});

describe("Admin", () => {
  it("vê todos os clientes e eventos", async () => {
    await as("admin", async (tx) => {
      expect(await tx.event.count({ where: { id: { in: [d.events.rock.id, d.events.congresso.id] } } })).toBe(2);
      expect(await tx.occurrence.count({ where: { eventId: d.events.congresso.id } })).toBeGreaterThan(0);
    });
  });
});

describe("tabelas de sessão", () => {
  it("são inacessíveis para o papel da aplicação", async () => {
    await expectPgError(as("admin", (tx) => tx.session.count()), RLS);
    await expectPgError(as("admin", (tx) => tx.account.findMany()), RLS);
  });
});
