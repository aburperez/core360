import type { OccurrenceStatus, OccurrenceType, Priority, ReceiptStatus } from "../../generated/prisma/enums";

/**
 * Relatório diário: as contas, sem banco. Um "dia" é a data no fuso do evento
 * ("2026-10-06"). Tudo aqui é função pura, testada em tests/preproducao.
 */

export type ReportOccurrence = {
  id: string;
  number: number;
  type: OccurrenceType;
  title: string;
  areaName: string;
  teamName: string;
  serviceTypeName: string | null;
  status: OccurrenceStatus;
  priority: Priority;
  openedAt: Date;
  slaDueAt: Date | null;
  concludedAt: Date | null;
  durationSeconds: number | null;
  slaBreached: boolean | null;
};

export type ReportReceipt = {
  id: string;
  name: string;
  sectionName: string;
  receiverName: string;
  status: ReceiptStatus;
  quantity: number;
  receivedQuantity: number | null;
  receivedDescription: string | null;
  note: string | null;
  receivedAt: Date | null;
};

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Data local ("2026-10-06") de um instante, no fuso do evento. */
export function localDay(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Dias do relatório: do início ao fim do evento, mais qualquer dia com
 * movimento antes ou depois (montagem, desmontagem).
 */
export function reportDays(event: { startsAt: Date; endsAt: Date }, timeZone: string, activity: (Date | null)[]): string[] {
  const days = new Set<string>();
  const last = localDay(event.endsAt, timeZone);
  for (let d = localDay(event.startsAt, timeZone), n = 0; d <= last && n < 120; d = nextDay(d), n++) days.add(d);
  for (const a of activity) if (a) days.add(localDay(a, timeZone));
  return [...days].sort();
}

/** Hoje, se for dia do evento; senão o dia mais perto de hoje. */
export function defaultDay(days: string[], today: string): string {
  if (days.length === 0 || days.includes(today)) return today;
  if (today > days[days.length - 1]) return days[days.length - 1];
  if (today < days[0]) return days[0];
  return days.filter((d) => d < today).pop() ?? days[0];
}

function avg(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function slaOf(rows: ReportOccurrence[]) {
  const measured = rows.filter((o) => o.slaBreached !== null);
  const ok = measured.filter((o) => o.slaBreached === false).length;
  return { ok, total: measured.length, pct: measured.length ? Math.round((ok / measured.length) * 100) : null };
}

export function buildDayReport(input: {
  day: string;
  timeZone: string;
  now: Date;
  occurrences: ReportOccurrence[];
  receipts: ReportReceipt[];
}) {
  const { day, timeZone: tz, now, occurrences } = input;
  const today = localDay(now, tz);
  const on = (d: Date | null) => !!d && localDay(d, tz) === day;
  const by = (d: Date | null) => !!d && localDay(d, tz) <= day;

  const opened = occurrences.filter((o) => on(o.openedAt));
  const concluded = occurrences.filter((o) => o.status === "CONCLUIDO" && on(o.concludedAt));
  // Em aberto no fim do dia (ou agora, se o dia é hoje). Cancelados saem.
  const openAtEnd = occurrences.filter(
    (o) => o.status !== "CANCELADO" && by(o.openedAt) && !(o.status === "CONCLUIDO" && by(o.concludedAt)),
  );
  const lateOpen = openAtEnd.filter((o) =>
    o.slaDueAt && (day === today ? o.slaDueAt < now : day < today ? by(o.slaDueAt) : false),
  );
  const lateDone = concluded.filter((o) => o.slaBreached === true);
  const urgent = opened.filter((o) => o.priority === "CRITICA" || o.status === "URGENTE");

  type Group = { key: string; areaName: string; teamName: string; rows: ReportOccurrence[] };
  const teams = new Map<string, Group>();
  for (const o of [...opened, ...concluded, ...openAtEnd]) {
    const key = `${o.areaName}\u0000${o.teamName}`;
    if (!teams.has(key)) teams.set(key, { key, areaName: o.areaName, teamName: o.teamName, rows: [] });
  }
  const inTeam = (g: Group) => (o: ReportOccurrence) => o.areaName === g.areaName && o.teamName === g.teamName;
  const byTeam = [...teams.values()]
    .sort((a, b) => a.areaName.localeCompare(b.areaName, "pt-BR") || a.teamName.localeCompare(b.teamName, "pt-BR"))
    .map((g) => {
      const done = concluded.filter(inTeam(g));
      return {
        areaName: g.areaName,
        teamName: g.teamName,
        opened: opened.filter(inTeam(g)).length,
        concluded: done.length,
        openAtEnd: openAtEnd.filter(inTeam(g)).length,
        late: lateOpen.filter(inTeam(g)).length + lateDone.filter(inTeam(g)).length,
        avgSeconds: avg(done.map((o) => o.durationSeconds).filter((s): s is number => s !== null)),
        sla: slaOf(done),
      };
    });

  const typeNames = [...new Set([...opened, ...concluded].map((o) => o.serviceTypeName ?? ""))]
    .sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "pt-BR")));
  const byType = typeNames.map((name) => {
    const is = (o: ReportOccurrence) => (o.serviceTypeName ?? "") === name;
    const done = concluded.filter(is);
    return {
      name: name || "Sem tipo",
      opened: opened.filter(is).length,
      concluded: done.length,
      avgSeconds: avg(done.map((o) => o.durationSeconds).filter((s): s is number => s !== null)),
      sla: slaOf(done),
    };
  });

  const checked = input.receipts.filter((r) => r.status !== "PENDENTE" && on(r.receivedAt));
  return {
    day,
    isToday: day === today,
    isFuture: day > today,
    totals: {
      opened: opened.length,
      concluded: concluded.length,
      openAtEnd: openAtEnd.length,
      late: lateOpen.length + lateDone.length,
      avgSeconds: avg(concluded.map((o) => o.durationSeconds).filter((s): s is number => s !== null)),
      sla: slaOf(concluded),
    },
    byTeam,
    byType,
    lateOpen,
    lateDone,
    urgent,
    receipts: {
      ok: checked.filter((r) => r.status === "OK").length,
      different: checked.filter((r) => r.status === "DIFERENTE"),
      /** Ainda aguardando conferência agora (não é foto do dia). */
      pendingNow: input.receipts.filter((r) => r.status === "PENDENTE").length,
      sent: input.receipts.length,
    },
  };
}

export type DayReport = ReturnType<typeof buildDayReport>;
