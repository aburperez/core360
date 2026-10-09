import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectStatus, ownerDb, type Person } from "../helpers";
import { memoryStorage, setStorageForTests } from "@/server/storage/storage";
import { createEvent } from "@/modules/events/events.service";
import { createCostItem, createCostSection, updateCostItem } from "@/modules/costs/costs.service";
import { createArrival } from "@/modules/arrivals/arrivals.service";
import { createMilestone } from "@/modules/schedule/schedule.service";
import { buildReport, canOpenReport } from "@/modules/reports/build.service";
import { REPORT_KEYS, type Report } from "@/modules/reports/catalog";
import { writeReportXlsx } from "@/modules/reports/report-xlsx";

/**
 * Relatórios da fase 6B: só a Pré-produção abre, o financeiro e o executivo
 * só o diretor, valores em dinheiro só para o diretor e o do campo nunca tem
 * valor. O Excel sai com uma aba por tabela.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();

let ev: string;
let infra: string;
const now = new Date("2027-09-20T15:00:00-03:00");

const cells = (r: Report) => r.blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat() : b.rows.flat()));
const moneyColumns = (r: Report) => r.blocks.flatMap((b) => (b.kind === "table" ? b.columns.filter((c) => c.money).map((c) => c.header) : []));
const table = (r: Report, title: RegExp) => r.blocks.find((b) => b.kind === "table" && title.test(b.title)) as Extract<Report["blocks"][number], { kind: "table" }>;

beforeAll(async () => {
  setStorageForTests(memoryStorage());
  const e = await createEvent(await actorFor(db, "admin"), { clientId: d.clients.rock.id, name: "Feira dos relatórios", startsAt: "2027-09-25T10:00", endsAt: "2027-09-26T22:00" });
  ev = e.id;
  infra = (await owner.area.create({ data: { eventId: ev, name: "Infra" } })).id;
  const team = (await owner.team.create({ data: { eventId: ev, areaId: infra, name: "Palco" } })).id;
  const join = (p: Person, role: "GERENTE" | "PRE_PRODUTOR" | "HEAD" | "OPERACIONAL", areaId?: string, teamId?: string) =>
    owner.participant.create({ data: { eventId: ev, userId: d.users[p]!, name: p, email: `${p}-rl@rockfestival.dev`, role, areaId, teamId, joinedAt: new Date() } });
  await join("marina", "GERENTE");
  await join("sofia", "PRE_PRODUTOR");
  await join("rafael", "HEAD", infra);
  await join("pedro", "OPERACIONAL", infra, team);

  const m = await actorFor(db, "marina");
  const section = await createCostSection(m, ev, { name: "Estruturas" });
  const palco = (await createCostItem(m, section.id, { name: "Palco 12x8", quantity: 1, frequency: 1, unitValue: 50_000 })).id;
  await updateCostItem(m, palco, { areaId: infra, category: "INFRAESTRUTURA", contractedValue: 45_000, actualValue: 48_000, neededOn: "2027-09-10" });
  await createMilestone(m, ev, { title: "Fechar o palco", dueOn: "2027-09-15" });
  await createArrival(await actorFor(db, "sofia"), ev, { supplierName: "Palco Brasil", scheduledAt: "2027-09-20T08:00", endsAt: "2027-09-20T12:00", areaId: infra, itemIds: [palco] });
});

afterAll(async () => {
  await owner.event.update({ where: { id: ev }, data: { deletedAt: new Date() } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe("quem abre", () => {
  it("o diretor abre os 8; a pré-produtora, os 6 sem o financeiro e o executivo", async () => {
    const m = await actorFor(db, "marina");
    const s = await actorFor(db, "sofia");
    expect(REPORT_KEYS.filter((k) => canOpenReport(m, ev, k))).toHaveLength(8);
    expect(REPORT_KEYS.filter((k) => canOpenReport(s, ev, k))).toEqual(["book", "itens", "fornecedores", "montagem", "pendencias", "campo"]);
    await expectStatus(buildReport(s, ev, "financeiro", now), 404);
    await expectStatus(buildReport(s, ev, "executivo", now), 404);
  });

  it("Head e Operacional (só campo) não abrem nenhum", async () => {
    for (const p of ["rafael", "pedro"] as const) {
      const a = await actorFor(db, p);
      expect(REPORT_KEYS.filter((k) => canOpenReport(a, ev, k))).toEqual([]);
      await expectStatus(buildReport(a, ev, "itens", now), 404);
    }
  });
});

describe("valores", () => {
  it("master de itens: o diretor recebe os 4 valores; a pré-produtora, nenhum", async () => {
    const dir = await buildReport(await actorFor(db, "marina"), ev, "itens", now);
    expect(moneyColumns(dir)).toEqual(["Estimado", "Cotado", "Contratado", "Realizado"]);
    expect(cells(dir)).toEqual(expect.arrayContaining([50_000, 45_000, 48_000]));
    expect(dir.values).toBe(true);

    const pre = await buildReport(await actorFor(db, "sofia"), ev, "itens", now);
    expect(moneyColumns(pre)).toEqual([]);
    expect(cells(pre)).not.toEqual(expect.arrayContaining([50_000]));
    expect(pre.values).toBe(false);
    expect(table(pre, /Itens do evento/).rows[0]).toEqual(expect.arrayContaining(["Palco 12x8", "Infraestrutura", "Infra", "10/09/2027"]));
  });

  it("relatório do campo e book nunca têm valores, nem para o diretor", async () => {
    const m = await actorFor(db, "marina");
    for (const k of ["campo", "book", "montagem", "pendencias"] as const) {
      const r = await buildReport(m, ev, k, now);
      expect(moneyColumns(r)).toEqual([]);
      expect(cells(r).join(" ")).not.toMatch(/R\$|50\.?000|45\.?000|48\.?000/);
    }
  });

  it("fornecedores: valor e nota só para o diretor", async () => {
    expect(moneyColumns(await buildReport(await actorFor(db, "marina"), ev, "fornecedores", now))).toEqual(["Valor dos contratos"]);
    expect(moneyColumns(await buildReport(await actorFor(db, "sofia"), ev, "fornecedores", now))).toEqual([]);
  });
});

describe("conteúdo", () => {
  it("book junta ficha, cronograma, itens, montagem e equipe", async () => {
    const r = await buildReport(await actorFor(db, "sofia"), ev, "book", now);
    expect(r.blocks.map((b) => b.title)).toEqual(expect.arrayContaining([
      "Ficha do evento", expect.stringMatching(/^Cronograma \(0 de \d+ marcos feitos\)$/), "Itens do evento", "Fornecedores contratados", "Chegadas", "Itens a montar", "Equipe",
    ]));
    expect(table(r, /^Chegadas/).rows[0]).toEqual(expect.arrayContaining(["20/09/2027", "08:00", "12:00", "Palco Brasil", "Atrasada"]));
    expect(table(r, /^Equipe/).rows.map((x) => x[0])).toEqual(expect.arrayContaining(["marina", "rafael", "pedro"]));
  });

  it("pendências e executivo trazem o que está atrasado", async () => {
    const m = await actorFor(db, "marina");
    const p = await buildReport(m, ev, "pendencias", now);
    expect(table(p, /^Pendências/).rows.map((x) => x[2])).toEqual(expect.arrayContaining(["Fechar o palco"]));
    const x = await buildReport(m, ev, "executivo", now);
    expect(table(x, /riscos/).rows.map((r) => r[0])).toEqual(expect.arrayContaining(["1 item atrasado para ficar pronto"]));
    expect(table(x, /estouros/).rows[0]).toEqual([expect.any(String), "Palco 12x8", 3_000]);
  });

  it("Excel: aba Resumo e uma aba por tabela, dinheiro como número", async () => {
    const r = await buildReport(await actorFor(db, "marina"), ev, "financeiro", now);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await writeReportXlsx(r)).buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Por categoria", "Por centro de custo", "Itens", "Contratos"]);
    const items = wb.getWorksheet("Itens")!;
    expect(items.getRow(2).getCell(2).value).toBe("Palco 12x8");
    expect(items.getRow(2).getCell(7).value).toBe(45_000);
    expect(items.getColumn(7).numFmt).toContain("R$");
  });
});
