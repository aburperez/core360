import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { actorFor, appDb, demo, expectStatus, ownerDb } from "../helpers";
import { loadActor, type Actor } from "@/server/authz/actor";
import { DEFAULT_FUNCTIONS } from "@/modules/functions/functions.service";
import { exportFunctionsSheet, importFunctionsSheet } from "@/modules/functions/functions-sheet.service";
import { readDay, readTime } from "@/modules/functions/spreadsheet";

/**
 * Planilha de funções e áreas: baixa com o que o evento tem, a equipe mexe no
 * Excel e envia de volta. A prévia não grava; o envio cria e atualiza pelo
 * nome e nunca apaga. Áreas e equipes só mudam para o Gerente.
 */

const db = appDb();
const owner = ownerDb();
const d = demo();
afterAll(() => Promise.all([db.$disconnect(), owner.$disconnect()]));

const uniq = () => Math.random().toString(36).slice(2, 7);
const rock = d.events.rock.id;
let ev: string;
let joaoHere: string;
let carlaHere: string;
let ritaHere: string;
const emails = { joao: "", carla: "", rita: "", marina: "", sofia: "" };
/** Pessoas só deste evento (os outros testes contam as participações das pessoas do demo). */
const users = { gerente: "", pre: "", campo: "" };
const as = async (who: keyof typeof users): Promise<Actor> => (await loadActor(db, users[who]))!;

/** Um evento só destes testes, para não mexer nas funções do Rock. */
beforeAll(async () => {
  const e = await owner.event.create({
    data: { agencyId: d.agency.id, clientId: d.clients.rock.id, name: `Feira ${uniq()}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86400000) },
  });
  ev = e.id;
  for (const k of Object.keys(users) as (keyof typeof users)[]) {
    users[k] = (await owner.user.create({ data: { name: k, email: `${k}.${uniq()}@planilha.dev` } })).id;
  }
  const area = await owner.area.create({ data: { eventId: ev, name: "Infra" } });
  const team = await owner.team.create({ data: { eventId: ev, areaId: area.id, name: "Elétrica" } });
  await owner.participant.createMany({
    data: [
      { eventId: ev, name: "Marina", email: (emails.marina = `marina.${uniq()}@x.dev`), role: "GERENTE", userId: users.gerente },
      { eventId: ev, name: "Sofia", email: (emails.sofia = `sofia.${uniq()}@x.dev`), role: "PRE_PRODUTOR", userId: users.pre },
    ],
  });
  joaoHere = (await owner.participant.create({
    data: { eventId: ev, name: "João", email: (emails.joao = `joao.${uniq()}@x.dev`), role: "OPERACIONAL", areaId: area.id, teamId: team.id, userId: users.campo },
  })).id;
  carlaHere = (await owner.participant.create({
    data: { eventId: ev, name: "Carla", email: (emails.carla = `carla.${uniq()}@x.dev`), role: "OPERACIONAL", areaId: area.id, teamId: team.id },
  })).id;
  ritaHere = (await owner.participant.create({
    data: { eventId: ev, name: "Rita", email: (emails.rita = `rita.${uniq()}@x.dev`), role: "CLIENTE" },
  })).id;
});

async function load(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return wb;
}
const save = async (wb: ExcelJS.Workbook) => new Uint8Array(await wb.xlsx.writeBuffer());
const values = (ws: ExcelJS.Worksheet) =>
  ws.getSheetValues().slice(2).filter(Boolean).map((r) => (r as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)));

/** Planilha "do zero", como alguém montaria no Excel com as abas do modelo. */
async function sheet(tabs: { areas?: unknown[][]; functions?: unknown[][]; activities?: unknown[][] }) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Como preencher").addRow(["..."]);
  if (tabs.areas) wb.addWorksheet("Áreas e equipes").addRows([["Área", "Equipe", "Descrição"], ...tabs.areas]);
  if (tabs.functions) wb.addWorksheet("Funções").addRows([["Função", "Descrição"], ...tabs.functions]);
  if (tabs.activities) wb.addWorksheet("Atividades").addRows([["Função", "Atividade", "Dia", "Início", "Fim", "Local"], ...tabs.activities]);
  return save(wb);
}

describe("planilha de funções e áreas", () => {
  it("só a Pré-produção do evento baixa e envia", async () => {
    const file = await sheet({ functions: [["X", null]] });
    for (const p of ["joao", "rafael", "claudia"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(exportFunctionsSheet(a, rock), 404);
      await expectStatus(importFunctionsSheet(a, rock, file, { confirm: true }), 404);
    }
    // Quem é do campo neste evento não é Pré-produção.
    await expectStatus(exportFunctionsSheet(await as("campo"), ev), 404);
    // Gerente de outro evento.
    const paulo = await actorFor(db, "paulo");
    await expectStatus(exportFunctionsSheet(paulo, ev), 404);
    await expectStatus(importFunctionsSheet(paulo, ev, file, { confirm: true }), 404);
    expect(await owner.eventFunction.count({ where: { eventId: ev } })).toBe(0);
  });

  it("baixa com as áreas e equipes do evento e as 18 funções padrão quando ainda não há nenhuma", async () => {
    const { fileName, bytes } = await exportFunctionsSheet(await as("gerente"), ev);
    expect(fileName).toMatch(/^Funcoes e areas - Feira/);
    const wb = await load(bytes);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Como preencher", "Pessoas", "Áreas e equipes", "Funções", "Atividades"]);
    expect(values(wb.getWorksheet("Áreas e equipes")!)).toEqual([["Infra", "Elétrica", ""]]);
    expect(values(wb.getWorksheet("Funções")!).map((r) => r[0])).toEqual([...DEFAULT_FUNCTIONS]);
    // A coluna Função das atividades tem a lista da aba Funções.
    expect(wb.getWorksheet("Atividades")!.getCell("A2").dataValidation).toMatchObject({ type: "list", formulae: ["'Funções'!$A$2:$A$500"] });
  });

  it("a prévia não grava; ao confirmar cria tudo; enviar de novo não duplica", async () => {
    const marina = await as("gerente");
    const wb = await load((await exportFunctionsSheet(marina, ev)).bytes);
    wb.getWorksheet("Áreas e equipes")!.addRows([
      ["Palco", "", "Tudo do palco principal"],
      ["Palco", "Som", "PA e monitores"],
      ["palco ", "Luz", null],
      ["Infra", "Gerador", "Grupo gerador"],
    ]);
    wb.getWorksheet("Funções")!.addRow(["Roadie", "Monta e desmonta o palco"]);
    wb.getWorksheet("Atividades")!.addRows([
      ["Roadie", "Montar o palco", new Date("2026-11-15T00:00:00Z"), "08:00", "12:00", "Palco principal"],
      ["Roadie", "Passagem de som", "16/11/2026", 14 / 24, 0.75, null],
      ["Runner", "Buscar gelo", null, "9h", null, "Bar 3"],
    ]);
    const file = await save(wb);

    const preview = await importFunctionsSheet(marina, ev, file, { confirm: false });
    expect(preview).toMatchObject({
      saved: false, nothing: false, ignoredAreas: false,
      areas: { create: 1, update: 0, createNames: ["Palco"] },
      teams: { create: 3, update: 0, createNames: ["Infra › Gerador", "Palco › Som", "Palco › Luz"] },
      functions: { create: 19, update: 0 },
      activities: { create: 3, update: 0 },
      warnings: [],
    });
    expect(await owner.area.count({ where: { eventId: ev } })).toBe(1);
    expect(await owner.eventFunction.count({ where: { eventId: ev } })).toBe(0);

    expect(await importFunctionsSheet(marina, ev, file, { confirm: true })).toMatchObject({ saved: true });
    const palco = await owner.area.findFirstOrThrow({ where: { eventId: ev, name: "Palco" }, include: { teams: true } });
    expect(palco.description).toBe("Tudo do palco principal");
    expect(palco.teams.map((t) => t.name).sort()).toEqual(["Luz", "Som"]);
    expect(await owner.team.count({ where: { eventId: ev, name: "Gerador" } })).toBe(1);
    expect(await owner.eventFunction.count({ where: { eventId: ev } })).toBe(19);
    const acts = await owner.activity.findMany({ where: { eventId: ev }, orderBy: { title: "asc" }, include: { function: true } });
    expect(acts.map((a) => [a.function?.name, a.title, a.day?.toISOString().slice(0, 10) ?? null, a.startTime, a.endTime, a.place])).toEqual([
      ["Runner", "Buscar gelo", null, "09:00", null, "Bar 3"],
      ["Roadie", "Montar o palco", "2026-11-15", "08:00", "12:00", "Palco principal"],
      ["Roadie", "Passagem de som", "2026-11-16", "14:00", "18:00", null],
    ]);
    expect(await owner.auditLog.count({ where: { eventId: ev, entity: "functions_sheet" } })).toBe(1);

    // O mesmo arquivo de novo, e o que o app baixa agora: nada a mudar.
    expect(await importFunctionsSheet(marina, ev, file, { confirm: true })).toMatchObject({ nothing: true, saved: false });
    const again = (await exportFunctionsSheet(marina, ev)).bytes;
    expect(await importFunctionsSheet(marina, ev, again, { confirm: false })).toMatchObject({ nothing: true, warnings: [] });
  });

  it("nunca apaga: quem tem a função continua com ela e o que foi feito continua feito", async () => {
    const marina = await as("gerente");
    const roadie = await owner.eventFunction.findFirstOrThrow({ where: { eventId: ev, name: "Roadie" } });
    const montar = await owner.activity.findFirstOrThrow({ where: { eventId: ev, title: "Montar o palco" } });
    await owner.participantProfile.create({ data: { eventId: ev, participantId: joaoHere, functionId: roadie.id, updatedById: users.gerente } });
    await owner.activityCheck.create({ data: { eventId: ev, activityId: montar.id, participantId: joaoHere } });

    // Planilha só com uma função (com outra grafia) e uma atividade com hora nova.
    const file = await sheet({
      areas: [],
      functions: [["ROADIE", "Monta, desmonta e cuida do backline"]],
      activities: [["roadie", "montar o palco", "15/11/2026", "07:30", "", ""]],
    });
    const r = await importFunctionsSheet(marina, ev, file, { confirm: true });
    expect(r).toMatchObject({
      saved: true,
      functions: { create: 0, update: 1, updateNames: ["Roadie"] },
      activities: { create: 0, update: 1 },
      areas: { create: 0, update: 0 },
    });
    expect(await owner.eventFunction.count({ where: { eventId: ev } })).toBe(19);
    expect(await owner.area.count({ where: { eventId: ev, deletedAt: null } })).toBe(2);
    expect(await owner.activity.count({ where: { eventId: ev } })).toBe(3);
    const after = await owner.activity.findUniqueOrThrow({ where: { id: montar.id } });
    // Célula em branco não apaga: o fim e o local continuam.
    expect([after.startTime, after.endTime, after.place]).toEqual(["07:30", "12:00", "Palco principal"]);
    expect((await owner.eventFunction.findUniqueOrThrow({ where: { id: roadie.id } })).description).toBe("Monta, desmonta e cuida do backline");
    expect((await owner.participantProfile.findUniqueOrThrow({ where: { participantId: joaoHere } })).functionId).toBe(roadie.id);
    expect(await owner.activityCheck.count({ where: { activityId: montar.id, participantId: joaoHere } })).toBe(1);
  });

  it("para a Pré-produtora as áreas e as funções fora da lista padrão são ignoradas", async () => {
    const sofia = await as("pre");
    // Ela baixa com as áreas (para consultar), mas o texto avisa que não muda.
    const help = (await load((await exportFunctionsSheet(sofia, ev)).bytes)).getWorksheet("Como preencher")!;
    expect(values(help).flat().join(" ")).toMatch(/só o Gerente do evento pode mudá-las/);

    const file = await sheet({
      areas: [["Camarim", "Recepção", null], ["Infra", "", "Mudou"]],
      functions: [["Brindes", null], ["Camareira", null]],
      activities: [["Brindes", "Separar as sacolas", null, null, null, null], ["Camareira", "Arrumar camarim", null, null, null, null]],
    });
    const preview = await importFunctionsSheet(sofia, ev, file, { confirm: false });
    // "Brindes" já existe (é da lista padrão); "Camareira" é só do diretor de produção.
    expect(preview).toMatchObject({ ignoredAreas: true, areas: { create: 0, update: 0 }, teams: { create: 0 }, functions: { create: 0 } });
    expect(preview.warnings[0]).toMatch(/só o diretor de produção cria funções fora da lista/i);
    expect(preview.warnings.some((w) => /Áreas e equipes foi ignorada/.test(w))).toBe(true);
    await importFunctionsSheet(sofia, ev, file, { confirm: true });
    expect(await owner.area.count({ where: { eventId: ev, name: "Camarim" } })).toBe(0);
    expect((await owner.area.findFirstOrThrow({ where: { eventId: ev, name: "Infra" } })).description).toBeNull();
    expect(await owner.eventFunction.count({ where: { eventId: ev, name: "Camareira" } })).toBe(0);
    expect(await owner.activity.count({ where: { eventId: ev, title: "Separar as sacolas" } })).toBe(1);
    expect(preview.functions.create).toBe(0);
    expect(await owner.activity.count({ where: { eventId: ev, title: "Arrumar camarim" } })).toBe(0);

    // O diretor de produção (Gerente) envia a mesma planilha e a função entra.
    const marina = await as("gerente");
    await importFunctionsSheet(marina, ev, file, { confirm: true });
    expect(await owner.eventFunction.count({ where: { eventId: ev, name: "Camareira" } })).toBe(1);
  });

  it("linha com erro vira aviso e as outras entram", async () => {
    const marina = await as("gerente");
    const file = await sheet({
      functions: [["Bilheteria", null], ["", "sem nome"]],
      activities: [
        ["Bilheteria", "Abrir caixa", "31/02/2026", "08:00", null, null],
        ["Bilheteria", "Fechar caixa", "17/11/2026", "25:00", null, null],
        ["Bilheteria", "Conferir", "17/11/2026", "18:00", "17:00", null],
        ["Bilheteria", "Só fim", null, null, "10:00", null],
        ["Mágico", "Truque", null, null, null, null],
        ["Bilheteria", "Contar ingressos", "17-11-2026", "8h30", "10:00", "Guichê"],
      ],
    });
    const r = await importFunctionsSheet(marina, ev, file, { confirm: true });
    expect(r.activities.create).toBe(1);
    expect(r.warnings).toEqual([
      expect.stringMatching(/Funções, linha 3: falta o nome da função/),
      expect.stringMatching(/linha 2: dia "31\/02\/2026" não é uma data/),
      expect.stringMatching(/linha 3: início "25:00" não é uma hora/),
      expect.stringMatching(/linha 4: o fim é antes do início/),
      expect.stringMatching(/linha 5: tem fim mas não tem início/),
      expect.stringMatching(/a função "Mágico" não existe/),
    ]);
    const a = await owner.activity.findFirstOrThrow({ where: { eventId: ev, title: "Contar ingressos" } });
    expect([a.day?.toISOString().slice(0, 10), a.startTime, a.endTime, a.place]).toEqual(["2026-11-17", "08:30", "10:00", "Guichê"]);
  });

  it("recusa arquivo que não é a planilha", async () => {
    const marina = await as("gerente");
    await expectStatus(importFunctionsSheet(marina, ev, new TextEncoder().encode("nome;descricao\nA;B"), { confirm: false }), 422);
    const other = new ExcelJS.Workbook();
    other.addWorksheet("JOB").addRow(["Item", "Descritivo"]);
    await expectStatus(importFunctionsSheet(marina, ev, await save(other), { confirm: false }), 422);
    await expectStatus(importFunctionsSheet(marina, ev, new Uint8Array(3 * 1024 * 1024), { confirm: false }), 422);
  });
});

describe("leitura de dia e hora", () => {
  const cell = (value: unknown) => ({ value, text: String(value ?? "") }) as unknown as ExcelJS.Cell;
  it("aceita o que o Excel e as pessoas costumam escrever", () => {
    expect(readDay(cell(new Date("2026-11-15T00:00:00Z")))).toBe("2026-11-15");
    expect(readDay(cell(46341))).toBe("2026-11-15");
    expect(readDay(cell("15/11/26"))).toBe("2026-11-15");
    expect(readDay(cell("2026-11-15"))).toBe("2026-11-15");
    expect(readDay(cell(""))).toBeNull();
    expect(readDay(cell("amanhã"))).toBeUndefined();
    expect(readTime(cell(new Date("1899-12-30T08:15:00Z")))).toBe("08:15");
    expect(readTime(cell(0.5))).toBe("12:00");
    for (const t of ["8:00", "08:00", "8h", "8 h", "08h00"]) expect(readTime(cell(t))).toBe("08:00");
    expect(readTime(cell("24:00"))).toBeUndefined();
    expect(readTime(cell(null))).toBeNull();
  });
});

/** Linha da aba Pessoas pelo e-mail. Colunas: Nome, E-mail, Telefone, Área, Equipe, Perfil, Função, Visão do cliente. */
function personRow(wb: ExcelJS.Workbook, email: string) {
  const ws = wb.getWorksheet("Pessoas")!;
  for (let r = 2; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(2).text === email) return ws.getRow(r);
  throw new Error(`sem linha para ${email}`);
}

describe("aba Pessoas", () => {
  it("o Gerente muda perfil, lugar, função e a visão do cliente; o resto vira aviso", async () => {
    const marina = await as("gerente");
    const wb = await load((await exportFunctionsSheet(marina, ev)).bytes);
    const ws = wb.getWorksheet("Pessoas")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Nome", "E-mail", "Telefone", "Área", "Equipe", "Perfil", "Função", "Visão do cliente", "Empresa", "Responsável direto"]);
    expect(personRow(wb, emails.rita).getCell(8).text).toBe("Nada");
    expect(personRow(wb, emails.joao).getCell(7).text).toBe("Roadie");
    expect(personRow(wb, emails.joao).getCell(6).text).toBe("Operacional");

    personRow(wb, emails.joao).getCell(6).value = "Head";
    personRow(wb, emails.carla).getCell(5).value = "gerador";
    personRow(wb, emails.carla).getCell(7).value = "roadie";
    personRow(wb, emails.rita).getCell(8).value = "Andamento, custos";
    personRow(wb, emails.sofia).getCell(7).value = "Roadie";
    personRow(wb, emails.marina).getCell(6).value = "Head";
    ws.addRow(["Fulano", "ninguem@x.dev", "", "", "", "Operacional", "Roadie"]);
    ws.addRow(["Beltrano", "outro@x.dev", "", "Infra", "Gerador", "Chefe"]);
    ws.addRow(["Rita", emails.rita.toUpperCase(), "", "", "", "Cliente", "", "Andamento e Custos"]);
    const file = await save(wb);

    const preview = await importFunctionsSheet(marina, ev, file, { confirm: false });
    expect(preview.people).toMatchObject({ create: 0, update: 3 });
    expect(preview.people!.updateNames).toEqual(expect.arrayContaining([
      "João (perfil Operacional → Head (Infra))",
      "Carla (vai para Infra › Gerador; função Roadie)",
      "Rita (vê Andamento, Custos)",
    ]));
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/\(Marina\): você não muda a sua própria participação/),
      expect.stringMatching(/\(Sofia\): Pré-produtor não tem função/),
      expect.stringMatching(/ninguem@x.dev não está neste evento/),
      expect.stringMatching(/perfil "Chefe" não existe/),
      expect.stringMatching(/e-mail repetido/),
    ]));
    expect((await owner.participant.findUniqueOrThrow({ where: { id: joaoHere } })).role).toBe("OPERACIONAL");

    expect(await importFunctionsSheet(marina, ev, file, { confirm: true })).toMatchObject({ saved: true });
    const infra = await owner.area.findFirstOrThrow({ where: { eventId: ev, name: "Infra" }, include: { teams: true } });
    const joao = await owner.participant.findUniqueOrThrow({ where: { id: joaoHere } });
    expect([joao.role, joao.areaId, joao.teamId]).toEqual(["HEAD", infra.id, null]);
    const carla = await owner.participant.findUniqueOrThrow({ where: { id: carlaHere }, include: { profile: { include: { function: true } } } });
    expect([carla.role, carla.teamId, carla.profile?.function?.name]).toEqual(["OPERACIONAL", infra.teams.find((t) => t.name === "Gerador")!.id, "Roadie"]);
    expect(await owner.clientView.findUnique({ where: { participantId: ritaHere } })).toMatchObject({ progress: true, costs: true, team: false, updatedById: users.gerente });
    expect((await owner.participant.findUniqueOrThrow({ where: { id: (await owner.participant.findFirstOrThrow({ where: { eventId: ev, name: "Marina" } })).id } })).role).toBe("GERENTE");
    expect(await owner.auditLog.count({ where: { eventId: ev, entity: "participant", entityId: joaoHere, action: "ROLE_CHANGE" } })).toBe(1);
    // Baixar de novo e enviar sem mexer: nada muda.
    expect(await importFunctionsSheet(marina, ev, (await exportFunctionsSheet(marina, ev)).bytes, { confirm: false })).toMatchObject({ nothing: true, warnings: [] });
  });

  it("empresa e responsável direto: o Gerente muda; para a Pré-produtora vira aviso", async () => {
    const marina = await as("gerente");
    const wb = await load((await exportFunctionsSheet(marina, ev)).bytes);
    personRow(wb, emails.carla).getCell(9).value = "Locadora Luz";
    personRow(wb, emails.carla).getCell(10).value = "Joana";
    const r = await importFunctionsSheet(marina, ev, await save(wb), { confirm: true });
    expect(r.people!.updateNames).toEqual(["Carla (empresa Locadora Luz; responde a Joana)"]);
    expect(await owner.participant.findUniqueOrThrow({ where: { id: carlaHere } })).toMatchObject({ company: "Locadora Luz", directManager: "Joana" });
    // Baixar de novo traz os dois; em branco apaga.
    const again = await load((await exportFunctionsSheet(marina, ev)).bytes);
    expect(personRow(again, emails.carla).getCell(9).text).toBe("Locadora Luz");
    personRow(again, emails.carla).getCell(10).value = "";
    await importFunctionsSheet(marina, ev, await save(again), { confirm: true });
    expect((await owner.participant.findUniqueOrThrow({ where: { id: carlaHere } })).directManager).toBeNull();

    const sofia = await as("pre");
    const wbPre = await load((await exportFunctionsSheet(sofia, ev)).bytes);
    personRow(wbPre, emails.carla).getCell(8).value = "Outra";
    const p = await importFunctionsSheet(sofia, ev, await save(wbPre), { confirm: true });
    expect(p.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/empresa e responsável direto foram ignorados em 1 linha/)]));
    expect((await owner.participant.findUniqueOrThrow({ where: { id: carlaHere } })).company).toBe("Locadora Luz");
  });

  it("para a Pré-produtora só a função muda; sem coluna de visão", async () => {
    const sofia = await as("pre");
    const wb = await load((await exportFunctionsSheet(sofia, ev)).bytes);
    expect(wb.getWorksheet("Pessoas")!.getRow(1).values).toEqual([undefined, "Nome", "E-mail", "Telefone", "Área", "Equipe", "Perfil", "Função", "Empresa", "Responsável direto"]);
    expect(values(wb.getWorksheet("Como preencher")!).flat().join(" ")).toMatch(/só o Gerente do evento muda/);
    personRow(wb, emails.carla).getCell(6).value = "Head";
    personRow(wb, emails.carla).getCell(7).value = "Sem função";
    const r = await importFunctionsSheet(sofia, ev, await save(wb), { confirm: true });
    expect(r).toMatchObject({ saved: true, people: { update: 1 } });
    expect(r.warnings[0]).toMatch(/perfil, área e equipe foram ignorados em 1 linha/);
    const carla = await owner.participant.findUniqueOrThrow({ where: { id: carlaHere }, include: { profile: true } });
    expect([carla.role, carla.profile?.functionId]).toEqual(["OPERACIONAL", null]);
  });
});
