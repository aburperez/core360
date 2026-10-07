import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import {
  DEFAULT_FUNCTIONS,
  addFunctionActivity,
  addPersonActivity,
  createDefaultFunctions,
  createFunction,
  deleteFunction,
  getFunction,
  getFunctionsPanel,
  getMyPlan,
  getPersonPlan,
  myPlanSummary,
  saveMyProfile,
  savePersonProfile,
  setActivityDone,
  setFunctionPeople,
  setPersonFunction,
  updateActivity,
} from "@/modules/functions/functions.service";

/**
 * Painel de funções: a Pré-produção cria as funções do evento, com atividades,
 * e dá a função às pessoas do campo. A pessoa vê a sua função e a sua agenda,
 * marca o que fez e preenche a própria ficha. Ninguém mais vê a ficha.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
afterAll(() => Promise.all([db.$disconnect(), owner.$disconnect()]));

const rock = d.events.rock.id;
const congresso = d.events.congresso.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);
const uniq = () => Math.random().toString(36).slice(2, 7);

describe("funções do evento", () => {
  it("a lista padrão entra com um toque, uma vez só; só a Pré-produção mexe", async () => {
    for (const p of ["rafael", "joao", "claudia"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(createDefaultFunctions(a, rock), 404);
      await expectStatus(getFunctionsPanel(a, rock), 404);
      await expectStatus(createFunction(a, rock, { name: "X" }), 404);
    }
    const sofia = await actorFor(db, "sofia");
    expect((await getFunctionsPanel(sofia, rock)).defaults).toHaveLength(DEFAULT_FUNCTIONS.length);
    expect(await createDefaultFunctions(sofia, rock)).toEqual({ count: DEFAULT_FUNCTIONS.length });
    expect(await createDefaultFunctions(sofia, rock)).toEqual({ count: 0 });
    const panel = await getFunctionsPanel(sofia, rock);
    expect(panel.defaults).toEqual([]);
    expect(panel.functions.map((f) => f.name)).toEqual(expect.arrayContaining(["A&B", "Caex / Credenciamento / CAM", "Runner"]));
    // Quem é do outro evento não vê estas funções.
    const paulo = await actorFor(db, "paulo");
    await expectStatus(getFunctionsPanel(paulo, rock), 404);
    expect(await as("paulo", (tx) => tx.eventFunction.count({ where: { eventId: rock } }))).toBe(0);
  });

  it("nome repetido no mesmo evento é recusado, mesmo com letras diferentes", async () => {
    const marina = await actorFor(db, "marina");
    await createFunction(marina, rock, { name: `Palco ${uniq()}` }).then(async (f) => {
      await expectStatus(createFunction(marina, rock, { name: f!.name.toUpperCase() }), 409);
    });
    await expectStatus(createFunction(marina, rock, { name: "   " }), 422);
  });

  it("dá a função às pessoas do campo; Cliente, Pré-produtor e gente de outro evento não", async () => {
    const marina = await actorFor(db, "marina");
    const f = (await createFunction(marina, rock, { name: `Eletricista ${uniq()}`, description: "Cuida dos quadros" }))!;
    await setFunctionPeople(marina, f.id, { participantIds: [P.joao.id, P.carlos.id] });
    await expectStatus(setFunctionPeople(marina, f.id, { participantIds: [P.claudia.id] }), 422);
    await expectStatus(setFunctionPeople(marina, f.id, { participantIds: [P.sofia.id] }), 422);
    await expectStatus(setFunctionPeople(marina, f.id, { participantIds: [P.joaoCongresso.id] }), 422);

    let panel = await getFunctionsPanel(marina, rock);
    expect(panel.functions.find((x) => x.id === f.id)?.peopleCount).toBe(2);
    expect(panel.people.find((p) => p.id === P.joao.id)?.functionId).toBe(f.id);
    expect(panel.people.map((p) => p.id)).not.toContain(P.claudia.id);

    // Desmarcar tira a função; a pessoa fica sem função.
    await setFunctionPeople(marina, f.id, { participantIds: [P.joao.id] });
    panel = await getFunctionsPanel(marina, rock);
    expect(panel.people.find((p) => p.id === P.carlos.id)?.functionId).toBeNull();

    // Uma pessoa por vez, no painel.
    await setPersonFunction(marina, rock, P.pedro.id, { functionId: f.id });
    expect((await getFunction(marina, f.id)).people.filter((p) => p.function?.id === f.id).map((p) => p.id).sort())
      .toEqual([P.joao.id, P.pedro.id].sort());
    await setPersonFunction(marina, rock, P.pedro.id, { functionId: null });
    // Função de outro evento não serve.
    const paulo = await actorFor(db, "paulo");
    const other = (await createFunction(paulo, congresso, { name: `Outra ${uniq()}` }))!;
    await expectStatus(setPersonFunction(marina, rock, P.pedro.id, { functionId: other.id }), 404);
    await expectStatus(getFunction(marina, other.id), 404);
  });

  it("a pessoa vê a função e a agenda dela, marca feito; quem não tem a função não vê", async () => {
    const marina = await actorFor(db, "marina");
    const f = (await createFunction(marina, rock, { name: `Credenciamento ${uniq()}`, description: "Entrega das pulseiras" }))!;
    await setFunctionPeople(marina, f.id, { participantIds: [P.ana.id] });
    const a1 = await addFunctionActivity(marina, f.id, { title: "Montar o balcão", day: "2027-04-09", startTime: "08:00", endTime: "12:00", place: "Portão 1" });
    const a2 = await addFunctionActivity(marina, f.id, { title: "Treinamento", day: "2027-04-08", startTime: "14:00" });
    await expectStatus(addFunctionActivity(marina, f.id, { title: "X", startTime: "10:00", endTime: "09:00" }), 422);
    await expectStatus(addFunctionActivity(marina, f.id, { title: "X", startTime: "25:00" }), 422);
    await expectStatus(addFunctionActivity(marina, f.id, { title: "X", endTime: "09:00" }), 422);
    const own = await addPersonActivity(marina, rock, P.ana.id, { title: "Buscar rádios", day: "2027-04-09" });

    const ana = await actorFor(db, "ana");
    const mine = (await getMyPlan(ana, rock))!;
    expect(mine.function).toMatchObject({ id: f.id, description: "Entrega das pulseiras" });
    expect(mine.activities.map((a) => a.id)).toEqual([a2.id, a1.id, own.id]);
    expect(await myPlanSummary(ana, rock)).toEqual({ has: true, pending: 3 });

    await setActivityDone(ana, rock, a1.id, { done: true });
    expect((await getMyPlan(ana, rock))!.activities.find((a) => a.id === a1.id)?.doneAt).toBeInstanceOf(Date);
    expect(await myPlanSummary(ana, rock)).toEqual({ has: true, pending: 2 });
    const panel = await getFunctionsPanel(marina, rock);
    expect(panel.people.find((p) => p.id === P.ana.id)?.activities).toEqual({ total: 3, done: 1 });
    await setActivityDone(ana, rock, a1.id, { done: false });
    expect(await myPlanSummary(ana, rock)).toEqual({ has: true, pending: 3 });

    // Bruno não tem a função: não vê, não marca, nem direto no banco.
    const bruno = await actorFor(db, "bruno");
    expect((await getMyPlan(bruno, rock))!.activities.map((a) => a.id)).not.toContain(a1.id);
    await expectStatus(setActivityDone(bruno, rock, a1.id, { done: true }), 404);
    expect(await as("bruno", (tx) => tx.eventFunction.findMany({ where: { id: f.id } }))).toEqual([]);
    expect(await as("bruno", (tx) => tx.activity.findMany({ where: { id: { in: [a1.id, own.id] } } }))).toEqual([]);
    await expectPgError(
      as("bruno", (tx) => tx.$executeRaw`INSERT INTO activity_checks (activity_id, participant_id, event_id) VALUES (${a1.id}::uuid, ${P.bruno.id}::uuid, ${rock}::uuid)`),
      "42501",
    );
    // Nem marca em nome da Ana.
    await expectPgError(
      as("bruno", (tx) => tx.$executeRaw`INSERT INTO activity_checks (activity_id, participant_id, event_id) VALUES (${a1.id}::uuid, ${P.ana.id}::uuid, ${rock}::uuid)`),
      "42501",
    );
    // A Ana não muda a atividade.
    expect(await as("ana", (tx) => tx.$executeRaw`UPDATE activities SET title = 'x' WHERE id = ${a1.id}::uuid`)).toBe(0);
    await expectStatus(updateActivity(ana, a1.id, { title: "x" }), 404);
  });

  it("apagar a função tira de quem tinha, junto com as atividades", async () => {
    const marina = await actorFor(db, "marina");
    const f = (await createFunction(marina, rock, { name: `Temporária ${uniq()}` }))!;
    await setFunctionPeople(marina, f.id, { participantIds: [P.bruno.id] });
    const a = await addFunctionActivity(marina, f.id, { title: "Algo" });
    const bruno = await actorFor(db, "bruno");
    await setActivityDone(bruno, rock, a.id, { done: true });
    await deleteFunction(marina, f.id);
    expect(await owner.activity.count({ where: { id: a.id } })).toBe(0);
    expect(await owner.activityCheck.count({ where: { activityId: a.id } })).toBe(0);
    expect((await owner.participantProfile.findUnique({ where: { participantId: P.bruno.id } }))?.functionId).toBeNull();
  });
});

describe("ficha da pessoa", () => {
  it("a pessoa preenche a dela; a Pré-produção vê; colegas, Head e Cliente não", async () => {
    const joao = await actorFor(db, "joao");
    await saveMyProfile(joao, rock, { document: "123.456.789-00", uniformSize: "G", dietary: "Vegetariano", emergencyName: "Maria", emergencyPhone: "11 90000-0000" });
    expect((await getMyPlan(joao, rock))!.profile).toMatchObject({ document: "123.456.789-00", uniformSize: "G" });

    const sofia = await actorFor(db, "sofia");
    expect((await getPersonPlan(sofia, rock, P.joao.id)).profile).toMatchObject({ dietary: "Vegetariano" });
    expect((await getFunctionsPanel(sofia, rock)).people.find((p) => p.id === P.joao.id)?.profileFilled).toBe(5);

    for (const p of ["carlos", "rafael", "claudia"] as const) {
      expect(await as(p, (tx) => tx.participantProfile.findMany({ where: { participantId: P.joao.id } }))).toEqual([]);
      await expectStatus(getPersonPlan(await actorFor(db, p), rock, P.joao.id), 404);
    }
    // O documento não vai para o histórico, só o nome do campo.
    const logs = await owner.auditLog.findMany({ where: { entity: "participant_profile", entityId: P.joao.id } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.map((l) => [l.before, l.after]))).not.toContain("123.456.789-00");
  });

  it("a pessoa não escolhe a própria função nem mexe na ficha dos outros", async () => {
    const marina = await actorFor(db, "marina");
    const f = (await createFunction(marina, rock, { name: `Chefia ${uniq()}` }))!;
    await saveMyProfile(await actorFor(db, "carlos"), rock, { uniformSize: "M" });
    await expectPgError(
      as("carlos", (tx) => tx.$executeRaw`UPDATE participant_profiles SET function_id = ${f.id}::uuid WHERE participant_id = ${P.carlos.id}::uuid`),
      "42501",
    );
    expect(await as("carlos", (tx) => tx.$executeRaw`UPDATE participant_profiles SET dietary = 'x' WHERE participant_id = ${P.joao.id}::uuid`)).toBe(0);
    await expectPgError(
      as("carlos", (tx) => tx.$executeRaw`INSERT INTO participant_profiles (participant_id, event_id, updated_by, updated_at) VALUES (${P.pedro.id}::uuid, ${rock}::uuid, ${d.users.carlos}::uuid, now())`),
      "42501",
    );
    // A Pré-produção preenche por ela, se precisar.
    await savePersonProfile(await actorFor(db, "sofia"), rock, P.pedro.id, { uniformSize: "GG" });
    expect((await owner.participantProfile.findUnique({ where: { participantId: P.pedro.id } }))?.uniformSize).toBe("GG");
    // Ficha não é para o Cliente.
    await expectStatus(savePersonProfile(marina, rock, P.claudia.id, { uniformSize: "P" }), 422);
    await expectStatus(getMyPlan(await actorFor(db, "claudia"), rock), 404);
    await expectStatus(saveMyProfile(await actorFor(db, "claudia"), rock, { uniformSize: "P" }), 404);
  });
});
