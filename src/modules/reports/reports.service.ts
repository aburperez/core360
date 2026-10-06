import ExcelJS from "exceljs";
import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import type { OccurrenceStatus, OccurrenceType, Priority } from "../../generated/prisma/enums";
import { canUsePreProduction, canWriteReport } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "../../server/errors";
import { parse } from "../../lib/validation";
import { PRIORITY_LABEL, STATUS_LABEL, formatDuration } from "../../lib/format";
import { requireEventAccess } from "../events/events.service";
import { DAY, buildDayReport, defaultDay, localDay, reportDays, type DayReport, type ReportOccurrence } from "./report";

/**
 * Relatório diário da Pré-produção: montado sozinho a partir dos chamados e
 * dos recebimentos do dia, mais as observações do gestor. Gerente e
 * Pré-produtor veem; só o Gerente escreve as observações. O Pré-produtor não
 * abre chamados: a lista vem de app.report_occurrences, que devolve só o que
 * o relatório mostra.
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

function checkDay(day: string) {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new ValidationError("Dia inválido");
  return new Date(`${day}T00:00:00Z`);
}

type RawOccurrence = {
  id: string; number: number; type: OccurrenceType; title: string;
  area_name: string; team_name: string; service_type_name: string | null;
  status: OccurrenceStatus; priority: Priority;
  opened_at: Date; sla_due_at: Date | null; concluded_at: Date | null;
  duration_seconds: number | null; sla_breached: boolean | null;
};

/** Relatório de um dia (ou do dia mais perto de hoje). */
export async function getDailyReport(actor: Actor, eventId: string, dayParam?: string | null, now = new Date()) {
  requirePre(actor, eventId);
  const data = await actor.run(async (tx) => {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { name: true, startsAt: true, endsAt: true, timezone: true } });
    if (!event) throw new NotFoundError("Evento");
    const raw = await tx.$queryRaw<RawOccurrence[]>`SELECT * FROM app.report_occurrences(${eventId}::uuid)`;
    const receipts = await tx.itemReceipt.findMany({
      where: { eventId },
      orderBy: [{ position: "asc" }],
      select: {
        id: true, name: true, sectionName: true, status: true, quantity: true, receivedQuantity: true,
        receivedDescription: true, note: true, receivedAt: true, receiver: { select: { name: true } },
      },
    });
    const notes = await tx.dailyNote.findMany({ where: { eventId }, select: { day: true, body: true, updatedAt: true, updatedBy: { select: { name: true } } } });
    return { event, raw, receipts, notes };
  });
  const tz = data.event.timezone || "America/Sao_Paulo";
  const occurrences: ReportOccurrence[] = data.raw.map((o) => ({
    id: o.id, number: o.number, type: o.type, title: o.title,
    areaName: o.area_name, teamName: o.team_name, serviceTypeName: o.service_type_name,
    status: o.status, priority: o.priority,
    openedAt: o.opened_at, slaDueAt: o.sla_due_at, concludedAt: o.concluded_at,
    durationSeconds: o.duration_seconds, slaBreached: o.sla_breached,
  }));
  const receipts = data.receipts.map((r) => ({
    id: r.id, name: r.name, sectionName: r.sectionName, receiverName: r.receiver.name, status: r.status,
    quantity: Number(r.quantity), receivedQuantity: r.receivedQuantity === null ? null : Number(r.receivedQuantity),
    receivedDescription: r.receivedDescription, note: r.note, receivedAt: r.receivedAt,
  }));
  const days = reportDays(data.event, tz, [
    ...occurrences.flatMap((o) => [o.openedAt, o.concludedAt]),
    ...receipts.map((r) => r.receivedAt),
  ]);
  const today = localDay(now, tz);
  const day = dayParam ? (checkDay(dayParam), dayParam) : defaultDay(days, today);
  const note = data.notes.find((n) => n.day.toISOString().slice(0, 10) === day) ?? null;
  return {
    event: { name: data.event.name, timeZone: tz },
    days: days.includes(day) ? days : [...days, day].sort(),
    daysWithNotes: data.notes.map((n) => n.day.toISOString().slice(0, 10)),
    report: buildDayReport({ day, timeZone: tz, now, occurrences, receipts }),
    note: note ? { body: note.body, updatedAt: note.updatedAt, updatedBy: (note.updatedBy as { name: string } | null)?.name ?? null } : null,
    can: { write: canWriteReport(actor, eventId), openTickets: actor.isAdmin || !!actor.memberships.find((m) => m.eventId === eventId && m.role === "GERENTE") },
  };
}

const noteSchema = z.object({ body: z.string().trim().max(5000).optional().nullable() });

/** Observações do dia. Texto vazio apaga. */
export async function saveDailyNote(actor: Actor, eventId: string, day: string, input: unknown) {
  requirePre(actor, eventId);
  if (!canWriteReport(actor, eventId)) throw new ForbiddenError("Só o gerente escreve as observações do dia");
  const date = checkDay(day);
  const { body } = parse(noteSchema, input);
  return actor.run(async (tx) => {
    const where = { eventId_day: { eventId, day: date } };
    const before = await tx.dailyNote.findUnique({ where });
    if (!body) {
      if (before) await tx.dailyNote.delete({ where });
    } else if (before) {
      await tx.dailyNote.update({ where, data: { body, updatedById: actor.userId } });
    } else {
      await tx.dailyNote.create({ data: { eventId, day: date, body, updatedById: actor.userId } });
    }
    if (before?.body !== (body || undefined)) {
      await audit(tx, actor, {
        eventId, entity: "daily_note", entityId: eventId, action: !body ? "DELETE" : before ? "UPDATE" : "CREATE",
        before: before ? { day, body: before.body } : null, after: body ? { day, body } : null,
      });
    }
    return { ok: true };
  });
}

// ───────────────────────────── Excel ─────────────────────────────

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF043246" } } as const;

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; width: number }[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = HEAD_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

function dayLabel(day: string) {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

function when(d: Date | null, tz: string) {
  if (!d) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
}

const pct = (s: { pct: number | null }) => (s.pct === null ? "—" : `${s.pct}%`);

export async function exportDailyReport(actor: Actor, eventId: string, day?: string | null) {
  const r = await getDailyReport(actor, eventId, day);
  return { fileName: `Relatório ${dayLabel(r.report.day).replace(/\//g, "-")} - ${r.event.name}.xlsx`, bytes: await writeReport(r.event, r.report, r.note?.body ?? null) };
}

async function writeReport(event: { name: string; timeZone: string }, rep: DayReport, note: string | null) {
  const wb = new ExcelJS.Workbook();
  const tz = event.timeZone;

  const s = sheet(wb, "Resumo", [{ header: `Relatório diário · ${event.name} · ${dayLabel(rep.day)}`, width: 44 }, { header: "", width: 18 }]);
  const t = rep.totals;
  s.addRows([
    ["Chamados abertos no dia", t.opened],
    ["Concluídos no dia", t.concluded],
    [rep.isToday ? "Em aberto agora" : "Em aberto no fim do dia", t.openAtEnd],
    ["Atrasados", t.late],
    ["Dentro do SLA (concluídos)", pct(t.sla)],
    ["Tempo médio até concluir", formatDuration(t.avgSeconds)],
    [],
    ["Itens conferidos: chegaram certo", rep.receipts.ok],
    ["Itens conferidos: chegaram diferente", rep.receipts.different.length],
    ["Itens aguardando conferência (agora)", rep.receipts.pendingNow],
    [],
    ["Observações do dia", note ?? ""],
  ]);
  s.getCell(`B${s.rowCount}`).alignment = { wrapText: true, vertical: "top" };
  s.getColumn(2).alignment = { horizontal: "left" };

  const tm = sheet(wb, "Por equipe", [
    { header: "Área", width: 22 }, { header: "Equipe", width: 22 }, { header: "Abertos", width: 10 },
    { header: "Concluídos", width: 12 }, { header: "Em aberto", width: 11 }, { header: "Atrasados", width: 11 },
    { header: "Dentro do SLA", width: 14 }, { header: "Tempo médio", width: 14 },
  ]);
  for (const g of rep.byTeam) tm.addRow([g.areaName, g.teamName, g.opened, g.concluded, g.openAtEnd, g.late, pct(g.sla), formatDuration(g.avgSeconds)]);

  const ty = sheet(wb, "Por tipo", [
    { header: "Tipo de atendimento", width: 32 }, { header: "Abertos", width: 10 }, { header: "Concluídos", width: 12 },
    { header: "Dentro do SLA", width: 14 }, { header: "Tempo médio", width: 14 },
  ]);
  for (const g of rep.byType) ty.addRow([g.name, g.opened, g.concluded, pct(g.sla), formatDuration(g.avgSeconds)]);

  const at = sheet(wb, "Atrasados e urgentes", [
    { header: "Situação", width: 22 }, { header: "#", width: 7 }, { header: "Chamado", width: 40 }, { header: "Equipe", width: 26 },
    { header: "Prioridade", width: 11 }, { header: "Status", width: 14 }, { header: "Aberto", width: 13 }, { header: "Prazo", width: 13 }, { header: "Concluído", width: 13 },
  ]);
  const occRow = (label: string, o: ReportOccurrence) =>
    at.addRow([label, o.number, o.title, `${o.areaName} › ${o.teamName}`, PRIORITY_LABEL[o.priority], STATUS_LABEL[o.status], when(o.openedAt, tz), when(o.slaDueAt, tz), when(o.concludedAt, tz)]);
  for (const o of rep.lateOpen) occRow("Atrasado, em aberto", o);
  for (const o of rep.lateDone) occRow("Concluído com atraso", o);
  for (const o of rep.urgent) occRow("Urgente / crítico", o);

  const rc = sheet(wb, "Recebimentos", [
    { header: "Seção", width: 26 }, { header: "Item", width: 34 }, { header: "Quem recebeu", width: 20 }, { header: "Pedido", width: 9 },
    { header: "Chegou", width: 9 }, { header: "O que chegou", width: 30 }, { header: "O que está diferente", width: 40 }, { header: "Conferido", width: 13 },
  ]);
  for (const r of rep.receipts.different) {
    rc.addRow([r.sectionName, r.name, r.receiverName, r.quantity, r.receivedQuantity ?? "", r.receivedDescription ?? "", r.note ?? "", when(r.receivedAt, tz)]);
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
