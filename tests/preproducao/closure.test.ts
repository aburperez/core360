import { randomBytes } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, ownerDb, workerDb, type Person } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { loadActor } from "@/server/authz/actor";
import { createEvent, listEvents } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { addDocument } from "@/modules/documents/documents.service";
import { dispatch } from "@/modules/notifications/dispatcher";
import { canCloseEvent, closeEvent, getArchived, getClosure, historyPart, listArchived, pendingClosures, splitParts } from "@/modules/closure/closure.service";

/**
 * Fase 6C: com o evento Concluído, o diretor recebe o aviso, baixa o
 * histórico (ZIP) e encerra digitando o nome. Fica só o resumo; fotos,
 * arquivos e pessoas saem. Ninguém mais encerra, e nada sai sozinho.
 */

const db = appDb();
const owner = ownerDb();
const worker = workerDb();
const d = demo();
const storage = memoryStorage();

let ev: string;
let docKey: string;
let ratingId: string;
const NAME = "Feira do encerramento";

const conclude = () => owner.event.update({ where: { id: ev }, data: { status: "CONCLUIDO" } });

beforeAll(async () => {
  setStorageForTests(storage);
  ev = (await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: NAME, startsAt: "2027-10-01T10:00", endsAt: "2027-10-02T22:00" })).id;
  const infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-enc@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("pedro", "OPERACIONAL", infra, team);

  const m = await actorFor(db, "marina");
  const section = await createCostSection(m, ev, { name: "Estruturas" });
  const palco = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  await updateCostItem(m, palco, { contractedValue: 45_000, actualValue: 48_000 });
  const doc = await addDocument(m, ev, { category: "OUTRO" }, { bytes: new Uint8Array([...Buffer.from("%PDF-1.7\n"), ...randomBytes(64)]), name: "memorial.pdf" });
  docKey = (await owner.eventDocument.findUniqueOrThrow({ where: { id: doc.id } })).storageKey;

  const { agencyId } = await owner.event.findUniqueOrThrow({ where: { id: ev }, select: { agencyId: true } });
  const supplier = await owner.supplier.upsert({
    where: { agencyId_cnpj: { agencyId, cnpj: "11222333000181" } },
    update: {},
    create: { agencyId, cnpj: "11222333000181", companyName: "Som Encerramento Ltda", createdById: d.users.marina! },
  });
  ratingId = (await owner.supplierRating.create({
    data: { eventId: ev, supplierId: supplier.id, quality: 5, deadline: 4, service: 5, cost: 4, flexibility: 5, problemSolving: 5, ratedById: d.users.marina! },
  })).id;
});

afterAll(async () => {
  // Encerrado não muda mais: tira o arquivo (como dono) para poder esconder o evento de teste.
  await owner.$executeRaw`DELETE FROM event_archives WHERE event_id = ${ev}::uuid`;
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect(), worker.$disconnect()]);
});

describe("antes de concluir", () => {
  it("só o diretor (Gerente ou Admin) chega ao encerramento", async () => {
    expect(canCloseEvent(await actorFor(db, "marina"), ev)).toBe(true);
    expect(canCloseEvent(await actorFor(db, "admin"), ev)).toBe(true);
    for (const p of ["sofia", "rafael", "pedro"] as const) {
      const a = await actorFor(db, p);
      expect(canCloseEvent(a, ev)).toBe(false);
      await expectStatus(getClosure(a, ev), 404);
      await expectStatus(historyPart(a, ev, 1), 404);
      await expectStatus(closeEvent(a, ev, { confirm: NAME, savedAllParts: true }), 404);
    }
  });

  it("sem estar Concluído, não baixa nem encerra", async () => {
    const m = await actorFor(db, "marina");
    expect((await getClosure(m, ev)).archive).toBeNull();
    await expectStatus(historyPart(m, ev, 1), 409);
    await expectStatus(closeEvent(m, ev, { confirm: NAME, savedAllParts: true }), 409);
  });
});

describe("concluído", () => {
  it("ao concluir, os Gerentes recebem o aviso; voltar a etapa desfaz", async () => {
    await conclude();
    const notes = await owner.notification.findMany({ where: { eventId: ev, type: "HISTORICO" } });
    // Os Gerentes do evento: marina e os diretores da agência, que entram como Gerente.
    const gerentes = (await owner.participant.findMany({ where: { eventId: ev, role: "GERENTE" } })).map((p) => p.userId);
    expect(gerentes).toContain(d.users.marina);
    expect(notes.map((n) => n.userId).sort()).toEqual(gerentes.sort());
    expect(notes[0]!.link).toBe(`/eventos/${ev}/encerramento`);

    await owner.event.update({ where: { id: ev }, data: { status: "FECHAMENTO" } });
    expect(await owner.eventArchive.count({ where: { eventId: ev } })).toBe(0);
    await conclude();
    expect(await owner.eventArchive.count({ where: { eventId: ev } })).toBe(1);
  });

  it("lembrete semanal enquanto não baixou", async () => {
    await owner.eventArchive.update({ where: { eventId: ev }, data: { concludedAt: new Date(Date.now() - 8 * 86_400_000) } });
    const r = await dispatch({ db: worker, whatsapp: null });
    expect(r.history).toBeGreaterThanOrEqual(1);
    const titles = (await owner.notification.findMany({ where: { eventId: ev, type: "HISTORICO" } })).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["Lembrete: o histórico do evento ainda não foi baixado"]));
    // De novo na mesma semana: não repete.
    expect((await dispatch({ db: worker, whatsapp: null })).history).toBe(0);
  });

  it("Meus eventos mostra o que falta; sem baixar, não encerra", async () => {
    const m = await actorFor(db, "marina");
    expect((await pendingClosures(m, [{ id: ev, status: "CONCLUIDO" }])).get(ev)).toEqual({ downloaded: false });
    expect((await pendingClosures(await actorFor(db, "sofia"), [{ id: ev, status: "CONCLUIDO" }])).size).toBe(0);
    await expectStatus(closeEvent(m, ev, { confirm: NAME, savedAllParts: true }), 409);
  });

  it("a parte 1 do histórico traz os relatórios e os arquivos, e marca como baixado", async () => {
    const m = await actorFor(db, "marina");
    const c = await getClosure(m, ev);
    expect(c.parts).toHaveLength(1);
    expect(c.totals.files).toBe(1);
    await expectStatus(historyPart(m, ev, 2), 404);

    const z = await historyPart(m, ev, "1");
    expect(z.fileName).toBe("Historico - Feira do encerramento - parte 1 de 1.zip");
    const files = unzipSync(z.bytes);
    const names = Object.keys(files);
    expect(names.filter((n) => n.startsWith("relatorios/") && !n.includes("diarios"))).toHaveLength(8);
    expect(names).toEqual(expect.arrayContaining(["documentos/memorial.pdf", "LEIA-ME.txt"]));
    expect(strFromU8(files["LEIA-ME.txt"]!)).toContain("Parte 1 de 1");

    const after = await getClosure(m, ev);
    expect(after.archive).toMatchObject({ downloadedBy: expect.any(String), closed: false });
    expect(after.archive!.downloadedAt).toBeInstanceOf(Date);
    expect((await pendingClosures(m, [{ id: ev, status: "CONCLUIDO" }])).get(ev)).toEqual({ downloaded: true });
  });

  it("divide em partes abaixo do limite, com os relatórios na primeira", () => {
    const f = (size: number) => ({ size });
    expect(splitParts([f(1), f(2)], 10, 3).map((p) => p.length)).toEqual([2]);
    expect(splitParts([f(5), f(5), f(5)], 10, 3).map((p) => p.length)).toEqual([1, 2]);
    // Um arquivo maior que o limite vai sozinho numa parte.
    expect(splitParts([f(20), f(1)], 10, 0).map((p) => p.length)).toEqual([1, 1]);
  });
});

describe("encerrar", () => {
  it("exige a caixa marcada e o nome certo", async () => {
    const m = await actorFor(db, "marina");
    await expectStatus(closeEvent(m, ev, { confirm: NAME }), 422);
    await expectStatus(closeEvent(m, ev, { confirm: "Outro nome", savedAllParts: true }), 422);
    expect(await owner.participant.count({ where: { eventId: ev } })).toBeGreaterThanOrEqual(4);
  });

  it("guarda o resumo e apaga pessoas, itens e arquivos; as notas dos fornecedores ficam", async () => {
    const m = await actorFor(db, "marina");
    expect(storage.objects.has(docKey)).toBe(true);
    const r = await closeEvent(m, ev, { confirm: `  ${NAME.toUpperCase()} `, savedAllParts: true });
    expect(r).toEqual({ eventId: ev, files: 1 });

    expect(await owner.participant.count({ where: { eventId: ev } })).toBe(0);
    expect(await owner.costItem.count({ where: { eventId: ev } })).toBe(0);
    expect(await owner.eventDocument.count({ where: { eventId: ev } })).toBe(0);
    expect(await owner.area.count({ where: { eventId: ev } })).toBe(0);
    expect(storage.objects.has(docKey)).toBe(false);
    expect(await owner.supplierRating.count({ where: { id: ratingId } })).toBe(1);

    const a = await getArchived(m, ev);
    expect(a.summary).toMatchObject({ name: NAME, client: expect.any(String), counts: { files: 1 } });
    expect(a.summary.counts.people).toBeGreaterThanOrEqual(4);
    expect(a.summary.totals).toMatchObject({ estimated: 50_000, contracted: 45_000, actual: 48_000 });
    expect(a.closedBy).toBeTruthy();
  });

  it("depois: some das listas, ninguém entra e o evento não muda mais", async () => {
    for (const p of ["marina", "admin"] as const) {
      const a = await actorFor(db, p);
      expect((await listEvents(a)).map((e) => e.id)).not.toContain(ev);
      await expectStatus(getClosure(a, ev), 404);
    }
    const admin = await loadActor(db, d.users.admin!);
    expect(admin!.adminEventIds.has(ev)).toBe(false);
    await expectPgError(owner.event.update({ where: { id: ev }, data: { name: "x" } }), "23514");
    await expectStatus(closeEvent(await actorFor(db, "admin"), ev, { confirm: NAME, savedAllParts: true }), 404);
  });

  it("o resumo aparece em Eventos encerrados só para o Admin e os diretores da agência", async () => {
    expect((await listArchived(await actorFor(db, "admin"))).map((a) => a.eventId)).toContain(ev);
    for (const p of ["sofia", "rafael", "pedro"] as const) {
      const a = await actorFor(db, p);
      expect((await listArchived(a)).map((x) => x.eventId)).not.toContain(ev);
      await expectStatus(getArchived(a, ev), 404);
    }
  });
});
