import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus, ownerDb, type Person, grantAllSections } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostSection, createCostItem } from "@/modules/costs/costs.service";
import { addPlanItems, MAX_PLAN_READS_PER_HOUR, planReaderOptions, readTechnicalPlan } from "@/modules/items/plan-reading.service";
import { anthropicPlanReader, PLAN_READER_MODEL, type PlanReader, type PlanReading } from "@/modules/items/plan-reader";

/**
 * Leitor de planta da área Técnica (2026-10-21). A IA só lê: os itens entram
 * na planilha quando a pessoa confere e toca em Adicionar (addPlanItems). Só
 * quem lança itens usa; o Pré-produtor de uma área, só na área dele. A
 * chamada à Anthropic é trocada por uma leitura de mentira.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

const PDF = { bytes: new TextEncoder().encode("%PDF-1.4\n% planta técnica\n"), name: "planta-palco.pdf" };
const DWG = { bytes: new TextEncoder().encode("AC1032 planta"), name: "palco.dwg" };

const reading = (over: Partial<PlanReading> = {}): PlanReading => ({
  isPlan: true,
  summary: "Palco principal 12x8 m com FOH a 25 m.",
  items: [
    { name: "  Caixa de som   line array ", category: "AUDIOVISUAL", quantity: 12, unit: "un", location: "Palco principal", description: "L-Acoustics K2" },
    { name: "Moving head beam", category: "ILUMINACAO", quantity: 24.0004, unit: "un", location: "Treliça frontal", description: null },
    { name: "Gerador 260 kVA", category: "TECNICA", quantity: null, unit: "kVA", location: "Área técnica", description: "Com QTA" },
    { name: "   ", category: "TECNICA", quantity: 1, unit: null, location: null, description: null },
    { name: "Painel de LED P3,9", category: "AUDIOVISUAL", quantity: -2, unit: "m²", location: "Fundo do palco", description: null },
  ],
  notes: "Carga total estimada: 380 kVA.\nPonto de rigging a 9 m.",
  usage: { input: 5200, output: 900 },
  ...over,
});

let next: PlanReading = reading();
const calls: { mime: string; ctx: { eventName: string; areaName: string | null } }[] = [];
const fake: PlanReader = async (file, ctx) => {
  calls.push({ mime: file.mime, ctx });
  return next;
};

let ev: string;
let tecnica: string;
let infra: string;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Show da planta", startsAt: "2027-12-01T10:00", endsAt: "2027-12-02T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infraestrutura" } })).id;
  tecnica = (await owner.area.create({ data: { eventId: ev, name: "Técnica" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "PRODUTOR_EXECUTIVO" | "CLIENTE" | "HEAD", areaId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-planta@rockfestival.dev`, role, areaId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR", infra);
  await join("ana", "PRODUTOR_EXECUTIVO");
  await grantAllSections(owner, ev);
  await join("claudia", "CLIENTE");
  await join("rafael", "HEAD", tecnica);
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

afterEach(() => {
  next = reading();
  calls.length = 0;
});

describe("leitura da planta", () => {
  it("o Gerente lê: a área Técnica vem sugerida e a lista vem arrumada, sem salvar nada", async () => {
    const marina = await actorFor(db, "marina");
    const opts = await planReaderOptions(marina, ev);
    expect(opts).toMatchObject({ suggestedAreaId: tecnica, areaLocked: false, canSaveDocument: true });
    const r = await readTechnicalPlan(marina, ev, PDF, {}, fake);
    expect(calls).toEqual([{ mime: "application/pdf", ctx: { eventName: "Show da planta", areaName: "Técnica" } }]);
    expect(r.areaId).toBe(tecnica);
    expect(r.items).toEqual([
      { name: "Caixa de som line array", category: "AUDIOVISUAL", quantity: 12, unit: "un", location: "Palco principal", description: "L-Acoustics K2", existing: false },
      { name: "Moving head beam", category: "ILUMINACAO", quantity: 24, unit: "un", location: "Treliça frontal", description: null, existing: false },
      { name: "Gerador 260 kVA", category: "TECNICA", quantity: null, unit: "kVA", location: "Área técnica", description: "Com QTA", existing: false },
      { name: "Painel de LED P3,9", category: "AUDIOVISUAL", quantity: null, unit: "m²", location: "Fundo do palco", description: null, existing: false },
    ]);
    expect(r.notes).toBe("Carga total estimada: 380 kVA.\nPonto de rigging a 9 m.");
    expect(r.warnings).toEqual(["2 itens ficaram sem quantidade: confira na planta."]);
    expect(await owner.costItem.count({ where: { eventId: ev } })).toBe(0);
    const log = await owner.auditLog.findFirstOrThrow({ where: { entity: "plan_reading", eventId: ev }, orderBy: { id: "desc" } });
    expect(log).toMatchObject({ actorUserId: d.users.marina, action: "CREATE" });
    expect(log.after).toMatchObject({ fileName: "planta-palco.pdf", model: PLAN_READER_MODEL, items: 4, inputTokens: 5200, outputTokens: 900 });
  });

  it("adicionar cria os itens na seção nova, na área, como A definir, e guarda a planta nos Documentos", async () => {
    const marina = await actorFor(db, "marina");
    const r = await addPlanItems(marina, ev, {
      areaId: tecnica, newSection: "Técnica", saveDocument: true,
      items: [
        { name: "Caixa de som line array", category: "AUDIOVISUAL", quantity: "12", unit: "un", location: "Palco principal", description: "L-Acoustics K2" },
        { name: "Gerador 260 kVA", category: "TECNICA", quantity: "1,5", unit: "kVA", location: null, description: null },
      ],
    }, PDF);
    expect(r).toMatchObject({ added: 2, sectionName: "Técnica", document: "saved" });
    const items = await owner.costItem.findMany({ where: { eventId: ev }, orderBy: { position: "asc" } });
    expect(items.map((i) => [i.name, i.category, Number(i.quantity), i.areaId, i.status, i.sectionId, i.position])).toEqual([
      ["Caixa de som line array", "AUDIOVISUAL", 12, tecnica, "A_DEFINIR", r.sectionId, 1],
      ["Gerador 260 kVA", "TECNICA", 1.5, tecnica, "A_DEFINIR", r.sectionId, 2],
    ]);
    expect(items.every((i) => i.number > 0)).toBe(true);
    const doc = await owner.eventDocument.findFirstOrThrow({ where: { eventId: ev } });
    expect(doc).toMatchObject({ category: "PLANTA", title: "Planta técnica · planta-palco", visibleToField: false });

    // A mesma planta de novo: os itens entram, o documento repetido só vira aviso.
    const again = await addPlanItems(marina, ev, {
      areaId: tecnica, sectionId: r.sectionId, saveDocument: true,
      items: [{ name: "Moving head beam", category: "ILUMINACAO", quantity: 24 }],
    }, PDF);
    expect(again).toMatchObject({ added: 1, sectionId: r.sectionId, document: "duplicate" });
    expect((await planReaderOptions(marina, ev)).suggestedSectionId).toBe(r.sectionId);
  });

  it("o que já está na planilha com o mesmo nome vem marcado", async () => {
    const r = await readTechnicalPlan(await actorFor(db, "marina"), ev, PDF, { areaId: tecnica }, fake);
    expect(r.items.filter((i) => i.existing).map((i) => i.name)).toEqual(["Caixa de som line array", "Moving head beam", "Gerador 260 kVA"]);
    expect(r.warnings).toContain("3 itens já estão na planilha com o mesmo nome e vieram desmarcados.");
  });

  it("Pré-produtor de uma área: lê e adiciona só na área dele", async () => {
    const sofia = await actorFor(db, "sofia");
    const opts = await planReaderOptions(sofia, ev);
    expect(opts).toMatchObject({ areaLocked: true, suggestedAreaId: infra, areas: [{ id: infra, name: "Infraestrutura" }] });
    const r = await readTechnicalPlan(sofia, ev, PDF, {}, fake);
    expect(r.areaId).toBe(infra);
    await expectStatus(addPlanItems(sofia, ev, { areaId: tecnica, newSection: "Técnica", items: [{ name: "Talha 1 t", category: "TECNICA", quantity: 4 }] }), 422);
    const ok = await addPlanItems(sofia, ev, { areaId: null, newSection: "Estrutura técnica", items: [{ name: "Talha 1 t", category: "TECNICA", quantity: 4 }] });
    expect((await owner.costItem.findFirstOrThrow({ where: { sectionId: ok.sectionId } })).areaId).toBe(infra);
    // O banco também barra outra área.
    await expect(as("sofia", (tx) => tx.costItem.create({
      data: { eventId: ev, sectionId: ok.sectionId, position: 9, name: "x", quantity: 1, areaId: tecnica },
    }))).rejects.toThrow();
  });

  it("valida o que entra: nome, quantidade, seção e área do evento", async () => {
    const marina = await actorFor(db, "marina");
    const item = { name: "Mesa de som", category: "AUDIOVISUAL", quantity: 1 };
    await expectStatus(addPlanItems(marina, ev, { areaId: tecnica, items: [item] }), 422);
    await expectStatus(addPlanItems(marina, ev, { areaId: tecnica, newSection: "X", items: [] }), 422);
    await expectStatus(addPlanItems(marina, ev, { areaId: tecnica, newSection: "X", items: [{ ...item, quantity: 0 }] }), 422);
    await expectStatus(addPlanItems(marina, ev, { areaId: tecnica, newSection: "X", items: [{ ...item, category: "MOBILIARIO" }] }), 422);
    await expectStatus(addPlanItems(marina, ev, { areaId: "00000000-0000-7000-8000-000000000000", newSection: "X", items: [item] }), 422);
    // Tudo ou nada: o item inválido no meio não deixa nenhum entrar.
    const before = await owner.costItem.count({ where: { eventId: ev } });
    await expectStatus(addPlanItems(marina, ev, { areaId: tecnica, newSection: "X", items: [item, { ...item, name: " " }] }), 422);
    expect(await owner.costItem.count({ where: { eventId: ev } })).toBe(before);
  });

  it("DWG e arquivo vazio não vão para a IA", async () => {
    const marina = await actorFor(db, "marina");
    await expect(readTechnicalPlan(marina, ev, DWG, {}, fake)).rejects.toThrow(/DWG/);
    await expectStatus(readTechnicalPlan(marina, ev, null, {}, fake), 422);
    expect(calls).toHaveLength(0);
  });

  it("campo, cliente, Produtor executivo e quem não é do evento não usam", async () => {
    for (const p of ["rafael", "claudia", "joao"] as Person[]) {
      await expectStatus(readTechnicalPlan(await actorFor(db, p), ev, PDF, {}, fake), 404);
      await expectStatus(addPlanItems(await actorFor(db, p), ev, { areaId: null, newSection: "X", items: [{ name: "a", category: "TECNICA", quantity: 1 }] }), 404);
    }
    await expectStatus(readTechnicalPlan(await actorFor(db, "ana"), ev, PDF, {}, fake), 403);
    expect(calls).toHaveLength(0);
  });

  it("planilha nova da seção existente continua na ordem", async () => {
    const marina = await actorFor(db, "marina");
    const s = await createCostSection(marina, ev, { name: "Som" });
    await createCostItem(marina, s.id, { name: "Já estava", quantity: 1 });
    await addPlanItems(marina, ev, { areaId: tecnica, sectionId: s.id, items: [{ name: "Sub grave", category: "AUDIOVISUAL", quantity: 8 }] });
    const items = await owner.costItem.findMany({ where: { sectionId: s.id }, orderBy: { position: "asc" }, select: { name: true } });
    expect(items.map((i) => i.name)).toEqual(["Já estava", "Sub grave"]);
  });

  it(`no máximo ${MAX_PLAN_READS_PER_HOUR} leituras por pessoa por hora`, async () => {
    await as("marina", (tx) => tx.auditLog.createMany({
      data: Array.from({ length: MAX_PLAN_READS_PER_HOUR }, () => ({ actorUserId: d.users.marina!, eventId: ev, entity: "plan_reading", entityId: ev, action: "CREATE" as const })),
    }));
    await expectStatus(readTechnicalPlan(await actorFor(db, "marina"), ev, PDF, {}, fake), 429);
    expect(calls).toHaveLength(0);
  });

  it("sem a chave da Anthropic a leitura fica desligada", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const sofia = await actorFor(db, "sofia");
      expect((await planReaderOptions(sofia, ev)).enabled).toBe(false);
      await expectStatus(readTechnicalPlan(sofia, ev, PDF), 503);
    } finally {
      if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
    }
  });
});

describe("chamada à Anthropic (servidor de mentira no lugar da API)", () => {
  let server: Server;
  let reply: { status: number; body: unknown };
  let seen: Record<string, unknown> | null = null;
  const env = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
  const message = (text: string, stop = "end_turn") => ({
    id: "msg_teste", type: "message", role: "assistant", model: PLAN_READER_MODEL, stop_reason: stop, stop_sequence: null,
    content: [{ type: "text", text }], usage: { input_tokens: 4100, output_tokens: 700 },
  });
  const out = {
    is_plan: true, summary: "Palco", notes: null,
    items: [{ name: "Moving head", category: "ILUMINACAO", quantity: 12, unit: "un", location: "Palco", description: null }],
  };

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      let raw = "";
      rq.on("data", (c) => (raw += c));
      rq.on("end", () => {
        seen = JSON.parse(raw);
        rs.writeHead(reply.status, { "content-type": "application/json" });
        rs.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_API_KEY = "chave-de-teste";
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const [k, v] of [["ANTHROPIC_API_KEY", env.key], ["ANTHROPIC_BASE_URL", env.url]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("manda o PDF como documento, com a área, e pede a lista no formato combinado", async () => {
    reply = { status: 200, body: message(JSON.stringify(out)) };
    const r = await anthropicPlanReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "Show", areaName: "Técnica" });
    expect(r).toMatchObject({ isPlan: true, items: [{ name: "Moving head", category: "ILUMINACAO", quantity: 12 }], usage: { input: 4100, output: 700 } });
    const body = seen as { model: string; output_config: { format: { type: string } }; messages: { content: { type: string; text?: string }[] }[] };
    expect(body.model).toBe(PLAN_READER_MODEL);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0]!.content[0]!.type).toBe("document");
    expect(body.messages[0]!.content[1]!.text).toContain("Área do evento que vai receber os itens: Técnica");
  });

  it("foto vai como imagem; resposta fora do formato ou recusada vira erro claro", async () => {
    reply = { status: 200, body: message(JSON.stringify(out)) };
    await anthropicPlanReader({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mime: "image/jpeg" }, { eventName: "Show", areaName: null });
    expect((seen as { messages: { content: { type: string }[] }[] }).messages[0]!.content[0]!.type).toBe("image");
    reply = { status: 200, body: message(JSON.stringify(out).slice(0, 40), "max_tokens") };
    await expectStatus(anthropicPlanReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "S", areaName: null }), 422);
    reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
    await expectStatus(anthropicPlanReader({ bytes: PDF.bytes, mime: "application/pdf" }, { eventName: "S", areaName: null }), 503);
  });
});
