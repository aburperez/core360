import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { canGiveFunction, canGiveFunctions } from "@/server/authz/policy";
import { createFunction, deleteFunction, getMyPlan, listFunctionChoices, setPersonFunction } from "@/modules/functions/functions.service";

/**
 * O Head dá a função aos Operacionais da área dele; a Pré-produção continua
 * dando a qualquer pessoa do campo. O Head não lê a ficha de ninguém.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const rock = d.events.rock.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const uniq = () => Math.random().toString(36).slice(2, 7);

let fnA = "";
let fnB = "";
// Os outros testes usam a função do João e do Carlos: devolve como estava.
let before: { participantId: string; functionId: string | null }[] = [];

beforeAll(async () => {
  before = await owner.participantProfile.findMany({
    where: { participantId: { in: [P.joao.id, P.carlos.id] } },
    select: { participantId: true, functionId: true },
  });
  const sofia = await actorFor(db, "sofia");
  fnA = (await createFunction(sofia, rock, { name: `Montagem ${uniq()}` })).id;
  fnB = (await createFunction(sofia, rock, { name: `Runner ${uniq()}` })).id;
});

afterAll(async () => {
  const sofia = await actorFor(db, "sofia");
  await deleteFunction(sofia, fnA);
  await deleteFunction(sofia, fnB);
  for (const b of before) await owner.participantProfile.update({ where: { participantId: b.participantId }, data: { functionId: b.functionId } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("o Head dá a função", () => {
  it("aos Operacionais da área dele, e a pessoa vê em Meu briefing", async () => {
    const rafael = await actorFor(db, "rafael");
    expect(await setPersonFunction(rafael, rock, P.joao.id, { functionId: fnA })).toEqual({ functionId: fnA });
    const choices = await listFunctionChoices(rafael, rock);
    expect(choices!.functions.map((f) => f.id)).toEqual(expect.arrayContaining([fnA, fnB]));
    expect(choices!.assigned[P.joao.id]).toBe(fnA);
    expect((await getMyPlan(await actorFor(db, "joao"), rock))?.function?.id).toBe(fnA);
    // Troca e tira.
    await setPersonFunction(rafael, rock, P.joao.id, { functionId: fnB });
    await setPersonFunction(rafael, rock, P.carlos.id, { functionId: null });
    expect((await listFunctionChoices(rafael, rock))!.assigned).toMatchObject({ [P.joao.id]: fnB });
    expect(await owner.auditLog.count({ where: { entity: "participant_profile", entityId: P.joao.id, actorUserId: d.users.rafael! } })).toBeGreaterThan(0);
  });

  it("não dá a quem não é Operacional da área dele", async () => {
    const rafael = await actorFor(db, "rafael");
    // Outro Head (não aparece para ele), Gerente e ele mesmo.
    await expectStatus(setPersonFunction(rafael, rock, P.beatriz.id, { functionId: fnA }), 404);
    await expectStatus(setPersonFunction(rafael, rock, P.marina.id, { functionId: fnA }), 403);
    await expectStatus(setPersonFunction(rafael, rock, P.rafael.id, { functionId: fnA }), 403);
    await expectStatus(setPersonFunction(rafael, rock, P.claudia.id, { functionId: fnA }), [404, 422]);
    // A Beatriz (A&B) não dá função ao pessoal da Infra.
    await expectStatus(setPersonFunction(await actorFor(db, "beatriz"), rock, P.joao.id, { functionId: fnA }), 404);
    // Operacional e Cliente não dão função.
    for (const p of ["joao", "claudia"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(setPersonFunction(a, rock, P.carlos.id, { functionId: fnA }), 404);
      expect(await listFunctionChoices(a, rock)).toBeNull();
    }
    // Função de outro evento.
    await expectStatus(setPersonFunction(rafael, rock, P.joao.id, { functionId: "00000000-0000-7000-8000-000000000000" }), 404);
  });

  it("a Beatriz só vê a própria área na lista", async () => {
    const choices = await listFunctionChoices(await actorFor(db, "beatriz"), rock);
    expect(choices!.functions.length).toBeGreaterThan(0);
    expect(choices!.assigned[P.joao.id]).toBeUndefined();
  });
});

describe("no banco", () => {
  it("o Head não lê a ficha nem grava direto; só pela função do banco", async () => {
    await setPersonFunction(await actorFor(db, "sofia"), rock, P.joao.id, { functionId: fnA });
    expect(await as("rafael", (tx) => tx.participantProfile.count({ where: { participantId: P.joao.id } }))).toBe(0);
    expect((await as("rafael", (tx) => tx.participantProfile.updateMany({ where: { participantId: P.joao.id }, data: { functionId: fnB } }))).count).toBe(0);
    const give = (p: Person, participant: string, fn: string | null) =>
      as(p, (tx) => tx.$queryRaw`SELECT app.give_function(${rock}::uuid, ${participant}::uuid, ${fn}::uuid)`);
    await expectPgError(give("rafael", P.marina.id, fnA), "42501");
    await expectPgError(give("beatriz", P.joao.id, fnA), "42501");
    await expectPgError(give("joao", P.carlos.id, fnA), "42501");
    await expectPgError(give("claudia", P.carlos.id, fnA), "42501");
    await expectPgError(give("paulo", P.carlos.id, fnA), "42501");
    await give("rafael", P.joao.id, fnB);
    expect((await owner.participantProfile.findUnique({ where: { participantId: P.joao.id } }))?.updatedById).toBe(d.users.rafael);
    // O Head vê as funções do evento, mas quem é de fora não.
    expect(await as("rafael", (tx) => tx.eventFunction.count({ where: { id: fnA } }))).toBe(1);
    expect(await as("paulo", (tx) => tx.eventFunction.count({ where: { id: fnA } }))).toBe(0);
    // A pessoa ainda preenche a própria ficha, mas não escolhe a função.
    await expectPgError(as("joao", (tx) => tx.participantProfile.update({ where: { participantId: P.joao.id }, data: { functionId: fnA } })), "42501");
  });

  it("paridade backend × banco", async () => {
    const bad: string[] = [];
    const targets = [P.joao, P.carlos, P.ana, P.inativo, P.rafael, P.beatriz, P.marina, P.claudia, P.sofia];
    for (const who of ["admin", "marina", "sofia", "rafael", "beatriz", "joao", "claudia", "paulo"] as const) {
      const a = await actorFor(db, who);
      await as(who, async (tx) => {
        const [g] = await tx.$queryRaw<{ r: boolean }[]>`SELECT app.can_give_functions(${rock}::uuid) AS r`;
        if (g.r !== canGiveFunctions(a, rock)) bad.push(`${who} dá função: backend=${canGiveFunctions(a, rock)} banco=${g.r}`);
        for (const t of targets) {
          const [r] = await tx.$queryRaw<{ r: boolean }[]>`SELECT app.can_give_function(${rock}::uuid, ${t.id}::uuid) AS r`;
          const ts = canGiveFunction(a, rock, t);
          if (r.r !== ts) bad.push(`${who} → ${t.name}: backend=${ts} banco=${r.r}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
