import type { OccurrenceStatus } from "../../generated/prisma/enums";
import { isEventAdmin, membershipFor, type Actor } from "../../server/authz/actor";
import { requireEventAccess } from "../events/events.service";
import { occurrenceScope } from "../occurrences/occurrences.service";

const OPEN: OccurrenceStatus[] = ["PENDENTE", "EM_ANDAMENTO", "URGENTE", "BLOQUEIO"];

/**
 * Dashboard adaptativo: o MESMO cálculo para todos, mas sempre sobre o escopo
 * do usuário (Gerente: evento; Head: área; Operacional: equipe + atribuídas).
 */
export async function getDashboard(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  const m = membershipFor(actor, eventId);
  const role = isEventAdmin(actor, eventId) ? "ADMIN" : m!.role;

  if (role === "CLIENTE") {
    const [areas, teams, people] = await actor.run((tx) =>
      Promise.all([
        tx.area.count({ where: { eventId, deletedAt: null } }),
        tx.team.count({ where: { eventId, deletedAt: null } }),
        tx.participant.count({ where: { eventId, deletedAt: null, active: true } }),
      ]),
    );
    return { role, structure: { areas, teams, people } } as const;
  }

  const scope = occurrenceScope(actor, eventId);
  return actor.run(async (tx) => {
    const [byStatus, sla, breachedOpen, byArea, byTeam, urgent, mine] = await Promise.all([
      tx.occurrence.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
      tx.occurrence.aggregate({
        where: { AND: [scope, { status: "CONCLUIDO" }] },
        _avg: { durationSeconds: true },
        _count: { _all: true },
      }),
      tx.occurrence.count({
        where: { AND: [scope, { status: { in: OPEN } }, { slaDueAt: { lt: new Date() } }] },
      }),
      tx.occurrence.groupBy({
        by: ["areaId", "status"],
        where: scope,
        _count: { _all: true },
      }),
      tx.occurrence.groupBy({
        by: ["teamId", "status"],
        where: scope,
        _count: { _all: true },
      }),
      tx.occurrence.findMany({
        where: { AND: [scope, { OR: [{ status: { in: ["URGENTE", "BLOQUEIO"] } }, { priority: "CRITICA", status: { in: OPEN } }] }] },
        orderBy: [{ slaDueAt: "asc" }],
        take: 5,
        select: { id: true, number: true, title: true, status: true, priority: true, slaDueAt: true, team: { select: { name: true } } },
      }),
      m
        ? tx.occurrence.findMany({
            where: { AND: [scope, { responsibleParticipantId: m.participantId, status: { in: OPEN } }] },
            orderBy: [{ slaDueAt: "asc" }],
            take: 10,
            select: { id: true, number: true, title: true, status: true, priority: true, slaDueAt: true },
          })
        : Promise.resolve([]),
    ]);

    const metOnTime = await tx.occurrence.count({ where: { AND: [scope, { status: "CONCLUIDO" }, { slaBreached: false }] } });

    // Quadro do painel: os primeiros de cada coluna (o total vem de byStatus).
    const boardSelect = {
      id: true, number: true, title: true, status: true, priority: true, slaDueAt: true,
      team: { select: { name: true } }, responsible: { select: { name: true } },
    } as const;
    const column = (status: OccurrenceStatus[], done = false) =>
      tx.occurrence.findMany({
        where: { AND: [scope, { status: { in: status } }] },
        orderBy: done ? [{ concludedAt: "desc" }] : [{ slaDueAt: "asc" }],
        take: 4,
        select: boardSelect,
      });
    const [cAttention, cPending, cDoing, cDone] = await Promise.all([
      column(["URGENTE", "BLOQUEIO"]), column(["PENDENTE"]), column(["EM_ANDAMENTO"]), column(["CONCLUIDO"], true),
    ]);

    const count = (s: OccurrenceStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const total = byStatus.reduce((n, r) => n + r._count._all, 0);

    const areaNames = new Map(
      (await tx.area.findMany({ where: { id: { in: [...new Set(byArea.map((r) => r.areaId))] } }, select: { id: true, name: true } }))
        .map((a) => [a.id, a.name]),
    );
    const teamNames = new Map(
      (await tx.team.findMany({ where: { id: { in: [...new Set(byTeam.map((r) => r.teamId))] } }, select: { id: true, name: true } }))
        .map((t) => [t.id, t.name]),
    );
    const rollup = (rows: { status: OccurrenceStatus; _count: { _all: number } }[], key: (r: never) => string, names: Map<string, string>) => {
      const acc = new Map<string, { id: string; name: string; total: number; open: number }>();
      for (const r of rows) {
        const id = key(r as never);
        const e = acc.get(id) ?? { id, name: names.get(id) ?? "—", total: 0, open: 0 };
        e.total += r._count._all;
        if (OPEN.includes(r.status)) e.open += r._count._all;
        acc.set(id, e);
      }
      return [...acc.values()].sort((a, b) => b.open - a.open || b.total - a.total);
    };

    return {
      role,
      totals: {
        total,
        pendente: count("PENDENTE"),
        emAndamento: count("EM_ANDAMENTO"),
        urgente: count("URGENTE"),
        bloqueio: count("BLOQUEIO"),
        concluido: count("CONCLUIDO"),
        cancelado: count("CANCELADO"),
      },
      sla: {
        avgSeconds: sla._avg.durationSeconds ? Math.round(sla._avg.durationSeconds) : null,
        concluded: sla._count._all,
        onTime: metOnTime,
        breachedOpen,
      },
      byArea: role === "OPERACIONAL" ? [] : rollup(byArea, (r: { areaId: string }) => r.areaId, areaNames),
      byTeam: rollup(byTeam, (r: { teamId: string }) => r.teamId, teamNames),
      urgent,
      mine,
      board: [
        { key: "atencao", label: "Urgentes e bloqueios", count: count("URGENTE") + count("BLOQUEIO"), rows: cAttention, filter: "status=URGENTE" },
        { key: "pendente", label: "Pendentes", count: count("PENDENTE"), rows: cPending, filter: "status=PENDENTE" },
        { key: "andamento", label: "Em andamento", count: count("EM_ANDAMENTO"), rows: cDoing, filter: "status=EM_ANDAMENTO" },
        { key: "concluido", label: "Concluídos", count: count("CONCLUIDO"), rows: cDone, filter: "status=CONCLUIDO" },
      ],
    } as const;
  });
}
