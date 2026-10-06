import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, expectPgError, expectStatus, type Person } from "../helpers";
import { withUser, type Tx } from "@/server/db/with-user";
import {
  applyBriefingToTeam,
  deleteBriefing,
  getBriefingFor,
  getMyBriefing,
  listBriefings,
  markBriefingRead,
  myBriefingState,
  saveBriefing,
} from "@/modules/briefings/briefings.service";
import { createServiceType, setServiceTypePerson } from "@/modules/service-types/service-types.service";
import { exportDailyReport, getDailyReport, saveDailyNote } from "@/modules/reports/reports.service";
import { buildDayReport, defaultDay, localDay, reportDays, type ReportOccurrence, type ReportReceipt } from "@/modules/reports/report";

/**
 * Pré-produção, etapa 2: briefing por pessoa e relatório diário.
 * Briefing: a Pré-produção escreve, cada pessoa lê só o seu e confirma.
 * Relatório: Gerente e Pré-produtor veem; só o Gerente escreve as observações;
 * o Pré-produtor vê a lista de chamados do relatório sem abrir os chamados.
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const rock = d.events.rock.id;
const congresso = d.events.congresso.id;
const P = d.participants;
const as = <T>(p: Person, fn: (tx: Tx) => Promise<T>) => withUser(db, d.users[p]!, fn);

describe("briefing por pessoa", () => {
  it("a Pré-produção escreve; Head, Operacional e Cliente não entram", async () => {
    const sofia = await actorFor(db, "sofia");
    const saved = await saveBriefing(sofia, rock, P.joao.id, {
      post: "Palco 2, gerador G3", schedule: "Sex 10/04: 08h às 20h", duties: "Ronda nos quadros a cada 2 horas",
    });
    expect(saved).toMatchObject({ version: 1, state: "NAO_LIDO" });

    for (const p of ["rafael", "joao", "claudia"] as const) {
      const a = await actorFor(db, p);
      await expectStatus(listBriefings(a, rock), 404);
      await expectStatus(saveBriefing(a, rock, P.carlos.id, { duties: "x" }), 404);
    }
    // Só para gente do campo, deste evento, e com algum texto.
    await expectStatus(saveBriefing(sofia, rock, P.claudia.id, { duties: "x" }), 422);
    await expectStatus(saveBriefing(sofia, rock, P.sofia.id, { duties: "x" }), 422);
    await expectStatus(saveBriefing(sofia, rock, P.joaoCongresso.id, { duties: "x" }), 404);
    await expectStatus(saveBriefing(sofia, rock, P.carlos.id, { duties: "   " }), 422);
    await expectStatus(listBriefings(sofia, congresso), 404);

    const list = await listBriefings(sofia, rock);
    expect(list.find((p) => p.id === P.joao.id)?.state).toBe("NAO_LIDO");
    expect(list.find((p) => p.id === P.carlos.id)?.state).toBe("SEM");
    // Quem não é do campo não aparece na lista.
    expect(list.map((p) => p.id)).not.toContain(P.sofia.id);
    expect(list.map((p) => p.id)).not.toContain(P.claudia.id);
  });

  it("tipos de atendimento e contatos entram sozinhos", async () => {
    const sofia = await actorFor(db, "sofia");
    const type = await createServiceType(sofia, { teamId: d.teams.eletrica.id, name: "Rearme de disjuntor (briefing)" });
    await setServiceTypePerson(sofia, type.id, { participantId: P.joao.id, does: true });

    const forJoao = await getBriefingFor(sofia, rock, P.joao.id);
    expect(forJoao.auto.types.map((t) => t.name)).toContain("Rearme de disjuntor (briefing)");
    const contacts = forJoao.auto.contacts.map((c) => c.id);
    expect(contacts).toEqual(expect.arrayContaining([P.marina.id, P.rafael.id]));
    expect(contacts).not.toContain(P.beatriz.id); // Head de outra área
    expect(contacts).not.toContain(P.joao.id);

    // A mesma coisa chega para o João, só com o que ele já pode ver.
    const mine = await getMyBriefing(await actorFor(db, "joao"), rock);
    expect(mine?.briefing.post).toBe("Palco 2, gerador G3");
    expect(mine?.auto.types.map((t) => t.name)).toContain("Rearme de disjuntor (briefing)");
    expect(mine?.auto.contacts.map((c) => c.id)).toEqual(expect.arrayContaining([P.marina.id, P.rafael.id]));
  });

  it("cada um lê só o seu e confirma; mudou o texto, lê de novo", async () => {
    const joao = await actorFor(db, "joao");
    const carlos = await actorFor(db, "carlos");
    const sofia = await actorFor(db, "sofia");
    expect(await getMyBriefing(carlos, rock)).toBeNull();
    expect(await myBriefingState(joao, rock)).toBe("NAO_LIDO");
    await markBriefingRead(joao, rock);
    expect(await myBriefingState(joao, rock)).toBe("LIDO");
    await expectStatus(markBriefingRead(carlos, rock), 404);

    // Salvar o mesmo texto não muda a versão; mudar o texto pede nova leitura.
    await saveBriefing(sofia, rock, P.joao.id, { post: "Palco 2, gerador G3", schedule: "Sex 10/04: 08h às 20h", duties: "Ronda nos quadros a cada 2 horas" });
    expect(await myBriefingState(joao, rock)).toBe("LIDO");
    const v2 = await saveBriefing(sofia, rock, P.joao.id, { post: "Palco 1", duties: "Ronda nos quadros a cada 2 horas" });
    expect(v2).toMatchObject({ version: 2, state: "MUDOU" });
    expect(await myBriefingState(joao, rock)).toBe("MUDOU");
    await markBriefingRead(joao, rock);
    expect((await getMyBriefing(joao, rock))?.state).toBe("LIDO");
  });

  it("o banco segura sozinho: ninguém lê o alheio nem muda o que não é seu", async () => {
    await saveBriefing(await actorFor(db, "sofia"), rock, P.carlos.id, { duties: "Apoio no palco 1" });
    // João só enxerga o próprio briefing.
    expect(await as("joao", (tx) => tx.briefing.count({ where: { eventId: rock } }))).toBe(1);
    expect(await as("rafael", (tx) => tx.briefing.count({ where: { eventId: rock } }))).toBe(0);
    expect(await as("paulo", (tx) => tx.briefing.count({ where: { eventId: rock } }))).toBe(0);
    // Mudar o próprio texto ou confirmar a leitura do outro, não.
    await expectPgError(as("joao", (tx) => tx.briefing.updateMany({ where: { participantId: P.joao.id }, data: { duties: "Folga" } })), "42501");
    expect(await as("joao", (tx) => tx.briefing.updateMany({ where: { participantId: P.carlos.id }, data: { readVersion: 1, readAt: new Date() } }))).toMatchObject({ count: 0 });
    // A Pré-produção não marca como lido por ninguém.
    await expectPgError(as("sofia", (tx) => tx.briefing.updateMany({ where: { participantId: P.carlos.id }, data: { readVersion: 1, readAt: new Date() } })), "42501");
    // E não cria briefing para quem não é do campo.
    await expectPgError(as("sofia", (tx) => tx.briefing.create({ data: { eventId: rock, participantId: P.claudia.id, duties: "x", updatedById: d.users.sofia! } })), "23514");
    await expectPgError(as("joao", (tx) => tx.briefing.create({ data: { eventId: rock, participantId: P.pedro.id, duties: "x", updatedById: d.users.joao! } })), "42501");
  });

  it("escreve uma vez para a equipe toda; apagar é da Pré-produção", async () => {
    const marina = await actorFor(db, "marina");
    // Outros testes também montam equipe: conta quem está na Estrutura agora.
    const team = (await listBriefings(marina, rock)).filter((p) => p.teamId === d.teams.estrutura.id).map((p) => p.id);
    expect(team).toEqual(expect.arrayContaining([P.marcos.id, P.lucas.id]));
    const r = await applyBriefingToTeam(marina, d.teams.estrutura.id, { schedule: "Montagem: 07h às 19h", duties: "Montagem do palco principal" });
    expect(r.count).toBe(team.length);
    const list = await listBriefings(marina, rock);
    expect(list.filter((p) => p.teamId === d.teams.estrutura.id).every((p) => p.state === "NAO_LIDO")).toBe(true);
    await expectStatus(applyBriefingToTeam(await actorFor(db, "rafael"), d.teams.estrutura.id, { duties: "x" }), 404);
    await expectStatus(applyBriefingToTeam(await actorFor(db, "paulo"), d.teams.estrutura.id, { duties: "x" }), 404);

    const carlos = list.find((p) => p.id === P.carlos.id)!.briefing!;
    await expectStatus(deleteBriefing(await actorFor(db, "joao"), carlos.id), 404);
    await deleteBriefing(marina, carlos.id);
    expect(await getMyBriefing(await actorFor(db, "carlos"), rock)).toBeNull();
  });
});

// ───────────────────────────── Relatório ─────────────────────────────

const TZ = "America/Sao_Paulo";
const at = (iso: string) => new Date(iso);

function occ(n: number, o: Partial<ReportOccurrence>): ReportOccurrence {
  return {
    id: `o${n}`, number: n, type: "OCORRENCIA", title: `Chamado ${n}`, areaName: "Infra", teamName: "Elétrica",
    serviceTypeName: null, status: "PENDENTE", priority: "NORMAL", openedAt: at("2027-04-10T12:00:00-03:00"),
    slaDueAt: null, concludedAt: null, durationSeconds: null, slaBreached: null, ...o,
  };
}

function receipt(n: number, o: Partial<ReportReceipt>): ReportReceipt {
  return {
    id: `r${n}`, name: `Item ${n}`, sectionName: "ESTRUTURA", receiverName: "João", status: "PENDENTE",
    quantity: 2, receivedQuantity: null, receivedDescription: null, note: null, receivedAt: null, ...o,
  };
}

describe("relatório diário: as contas", () => {
  it("dia é a data no fuso do evento", () => {
    expect(localDay(at("2027-04-11T02:30:00Z"), TZ)).toBe("2027-04-10"); // 23h30 em São Paulo
    expect(localDay(at("2027-04-11T03:30:00Z"), TZ)).toBe("2027-04-11");
    const days = reportDays({ startsAt: at("2027-04-10T12:00:00-03:00"), endsAt: at("2027-04-12T23:59:00-03:00") }, TZ, [at("2027-04-08T10:00:00-03:00"), null]);
    expect(days).toEqual(["2027-04-08", "2027-04-10", "2027-04-11", "2027-04-12"]);
    expect(defaultDay(days, "2027-04-11")).toBe("2027-04-11");
    expect(defaultDay(days, "2027-05-01")).toBe("2027-04-12");
    expect(defaultDay(days, "2027-01-01")).toBe("2027-04-08");
    expect(defaultDay(days, "2027-04-09")).toBe("2027-04-08");
  });

  it("abertos, concluídos, em aberto, SLA, tempo médio e atrasados", () => {
    const day = "2027-04-10";
    const rows = [
      // Concluído no dia, dentro do prazo, 30 min.
      occ(1, { status: "CONCLUIDO", serviceTypeName: "Troca de lâmpada", slaDueAt: at("2027-04-10T13:00:00-03:00"), concludedAt: at("2027-04-10T12:30:00-03:00"), durationSeconds: 1800, slaBreached: false }),
      // Concluído no dia, atrasado, 90 min.
      occ(2, { status: "CONCLUIDO", serviceTypeName: "Troca de lâmpada", slaDueAt: at("2027-04-10T13:00:00-03:00"), concludedAt: at("2027-04-10T13:30:00-03:00"), durationSeconds: 5400, slaBreached: true }),
      // Aberto às 23h30 (ainda dia 10 em São Paulo), crítico, prazo no dia 10: atrasado no fim do dia.
      occ(3, { teamName: "Estrutura", priority: "CRITICA", status: "URGENTE", openedAt: at("2027-04-11T02:30:00Z"), slaDueAt: at("2027-04-11T02:45:00Z") }),
      // Aberto no dia 9, concluído no dia 11: em aberto no fim do dia 10, prazo no dia 11.
      occ(4, { openedAt: at("2027-04-09T10:00:00-03:00"), slaDueAt: at("2027-04-11T10:00:00-03:00"), status: "CONCLUIDO", concludedAt: at("2027-04-11T09:00:00-03:00"), durationSeconds: 100, slaBreached: false }),
      // Cancelado: não conta como em aberto.
      occ(5, { status: "CANCELADO" }),
      // Dia 11: fora.
      occ(6, { openedAt: at("2027-04-11T09:00:00-03:00") }),
    ];
    const receipts = [
      receipt(1, { status: "OK", receivedAt: at("2027-04-10T09:00:00-03:00") }),
      receipt(2, { status: "DIFERENTE", receivedQuantity: 1, note: "faltou 1", receivedAt: at("2027-04-10T10:00:00-03:00") }),
      receipt(3, { status: "OK", receivedAt: at("2027-04-11T10:00:00-03:00") }),
      receipt(4, {}),
    ];
    const r = buildDayReport({ day, timeZone: TZ, now: at("2027-04-12T12:00:00-03:00"), occurrences: rows, receipts });
    expect(r.totals).toMatchObject({ opened: 4, concluded: 2, openAtEnd: 2, late: 2, avgSeconds: 3600, sla: { ok: 1, total: 2, pct: 50 } });
    expect(r.lateOpen.map((o) => o.number)).toEqual([3]);
    expect(r.lateDone.map((o) => o.number)).toEqual([2]);
    expect(r.urgent.map((o) => o.number)).toEqual([3]);
    expect(r.byTeam).toEqual([
      expect.objectContaining({ teamName: "Elétrica", opened: 3, concluded: 2, openAtEnd: 1, late: 1 }),
      expect.objectContaining({ teamName: "Estrutura", opened: 1, concluded: 0, openAtEnd: 1, late: 1 }),
    ]);
    expect(r.byType).toEqual([
      expect.objectContaining({ name: "Troca de lâmpada", opened: 2, concluded: 2, avgSeconds: 3600 }),
      expect.objectContaining({ name: "Sem tipo", opened: 2, concluded: 0 }),
    ]);
    expect(r.receipts).toMatchObject({ ok: 1, pendingNow: 1, sent: 4 });
    expect(r.receipts.different.map((x) => x.id)).toEqual(["r2"]);

    // Hoje: atrasado é o que passou do prazo até agora.
    const today = buildDayReport({ day: "2027-04-11", timeZone: TZ, now: at("2027-04-11T09:30:00-03:00"), occurrences: rows, receipts });
    expect(today.isToday).toBe(true);
    expect(today.lateOpen.map((o) => o.number)).toEqual([3]);
    expect(today.totals.concluded).toBe(1);
  });
});

describe("relatório diário: acesso", () => {
  it("Gerente e Pré-produtor veem; o Pré-produtor vê a lista sem abrir os chamados", async () => {
    const sofia = await actorFor(db, "sofia");
    const r = await getDailyReport(sofia, rock);
    expect(r.report.isToday).toBe(true);
    expect(r.report.urgent.map((o) => o.title)).toContain(d.occurrences.quadroEletrico.title);
    expect(r.can).toEqual({ write: false, openTickets: false });
    // Sem descrição nem pessoas na lista.
    const keys = Object.keys(r.report.urgent[0]);
    for (const k of ["description", "responsibleParticipantId", "createdById"]) expect(keys).not.toContain(k);
    // Continua sem abrir os chamados.
    expect(await as("sofia", (tx) => tx.occurrence.count({ where: { eventId: rock } }))).toBe(0);
    expect((await getDailyReport(await actorFor(db, "marina"), rock)).can).toEqual({ write: true, openTickets: true });

    for (const p of ["rafael", "joao", "claudia", "paulo"] as const) {
      await expectStatus(getDailyReport(await actorFor(db, p), rock), 404);
    }
    await expectStatus(getDailyReport(sofia, rock, "2027-13-45"), 422);
    // A função do banco também barra quem não é da Pré-produção.
    for (const p of ["rafael", "joao", "paulo"] as const) {
      await expectPgError(as(p, (tx) => tx.$queryRaw`SELECT * FROM app.report_occurrences(${rock}::uuid)`), "42501");
    }
  });

  it("observações: só o Gerente escreve; vazio apaga", async () => {
    const marina = await actorFor(db, "marina");
    const sofia = await actorFor(db, "sofia");
    await expectStatus(saveDailyNote(sofia, rock, "2027-04-10", { body: "Tentativa" }), 403);
    await expectStatus(saveDailyNote(await actorFor(db, "rafael"), rock, "2027-04-10", { body: "x" }), 404);
    await saveDailyNote(marina, rock, "2027-04-10", { body: "Chuva atrasou a montagem em 2 horas." });
    const r = await getDailyReport(sofia, rock, "2027-04-10");
    expect(r.note?.body).toBe("Chuva atrasou a montagem em 2 horas.");
    expect(r.daysWithNotes).toContain("2027-04-10");
    await expectPgError(
      as("sofia", (tx) => tx.dailyNote.create({ data: { eventId: rock, day: new Date("2027-04-11T00:00:00Z"), body: "x", updatedById: d.users.sofia! } })),
      "42501",
    );
    expect(await as("rafael", (tx) => tx.dailyNote.count({ where: { eventId: rock } }))).toBe(0);
    await saveDailyNote(marina, rock, "2027-04-10", { body: "  " });
    expect((await getDailyReport(sofia, rock, "2027-04-10")).note).toBeNull();
  });

  it("Baixar Excel com as abas do relatório", async () => {
    const marina = await actorFor(db, "marina");
    await saveDailyNote(marina, rock, localDay(new Date(), TZ), { body: "Dia tranquilo." });
    const { fileName, bytes } = await exportDailyReport(marina, rock);
    expect(fileName).toMatch(/^Relatório \d{2}-\d{2}-\d{4} - Rock Festival 2027\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumo", "Por equipe", "Por tipo", "Atrasados e urgentes", "Recebimentos"]);
    const resumo = wb.getWorksheet("Resumo")!;
    const values = resumo.getSheetValues().flat().map(String);
    expect(values).toContain("Dia tranquilo.");
    const late = wb.getWorksheet("Atrasados e urgentes")!.getSheetValues().flat().map(String);
    expect(late).toContain(d.occurrences.quadroEletrico.title);
    await expectStatus(exportDailyReport(await actorFor(db, "joao"), rock), 404);
  });
});
