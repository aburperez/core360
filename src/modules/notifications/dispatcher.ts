import type { PrismaClient } from "../../generated/prisma/client";
import type { NotificationType } from "../../generated/prisma/enums";
import { publicUrl } from "../../lib/public-url";
import { signClaim } from "../../server/whatsapp/actions";
import { TEMPLATE_ALERT, TEMPLATE_ALERT_CLAIM, type WhatsApp } from "../../server/whatsapp/whatsapp";
import {
  HEADLINE, MAX_REMINDERS, REMINDER_EVERY_MS, WHATSAPP_TYPES, personCanClaim, personCanSee,
  planForChange, planForSla, planUrgentReminder, type Change, type OccInfo, type Person, type Planned, type Snapshot,
} from "./rules";

/**
 * Despacho de avisos. Roda com o papel core_worker (src/server/db/client.ts):
 *  1. lê a fila de mudanças dos chamados (gravada por trigger) e cria os avisos;
 *  2. procura chamados com SLA perto de vencer ou vencido;
 *  3. reenvia o urgente ao encarregado que não respondeu em 5 minutos;
 *  4. envia pelo WhatsApp os avisos de quem aceitou, com novas tentativas.
 * Pode rodar várias vezes ao mesmo tempo: a fila usa SKIP LOCKED e cada aviso
 * tem uma chave que impede repetição.
 */

type Worker = PrismaClient;
type WTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface DispatchDeps {
  db: Worker;
  whatsapp: WhatsApp | null;
  now?: () => Date;
}

/** Depois disso o aviso perde o sentido no WhatsApp (fica só no app). */
const WHATSAPP_MAX_AGE_MS = 30 * 60_000;
const RETRY_MINUTES = [1, 5, 15];
const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

const occSelect = {
  id: true, number: true, title: true, eventId: true, clientId: true, areaId: true, teamId: true,
  responsibleParticipantId: true, status: true, slaDueAt: true,
  event: { select: { name: true } }, area: { select: { name: true } }, team: { select: { name: true } },
} as const;

function toInfo(o: {
  id: string; number: number; title: string; eventId: string; clientId: string; areaId: string; teamId: string;
  responsibleParticipantId: string | null; status: OccInfo["status"]; slaDueAt: Date | null;
  event: { name: string }; area: { name: string }; team: { name: string };
}): OccInfo {
  return {
    id: o.id, number: o.number, title: o.title, eventId: o.eventId, clientId: o.clientId, areaId: o.areaId,
    teamId: o.teamId, responsibleParticipantId: o.responsibleParticipantId, status: o.status, slaDueAt: o.slaDueAt,
    eventName: o.event.name, areaName: o.area.name, teamName: o.team.name,
  };
}

async function loadPeople(tx: WTx, eventIds: string[]): Promise<Person[]> {
  if (eventIds.length === 0) return [];
  const rows = await tx.participant.findMany({
    where: {
      eventId: { in: eventIds }, active: true, deletedAt: null, userId: { not: null },
      user: { active: true },
    },
    select: { id: true, userId: true, eventId: true, role: true, areaId: true, teamId: true },
  });
  return rows.map((r) => ({ participantId: r.id, userId: r.userId!, eventId: r.eventId, role: r.role, areaId: r.areaId, teamId: r.teamId }));
}

async function store(tx: WTx, planned: Planned[], occ: OccInfo, people: Person[]) {
  let created = 0;
  for (const p of planned) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO notifications (id, user_id, event_id, occurrence_id, type, title, body, dedupe_key)
      VALUES (gen_random_uuid(), ${p.userId}::uuid, ${occ.eventId}::uuid, ${occ.id}::uuid,
              ${p.type}::notification_type, ${p.title}, ${p.body}, ${p.dedupeKey})
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING id`;
    if (!rows[0]) continue;
    created++;
    if (!(p.whatsapp ?? WHATSAPP_TYPES.has(p.type))) continue;
    const contact = await tx.whatsappContact.findUnique({ where: { userId: p.userId } });
    if (!contact?.optedInAt) continue;
    const person = people.find((x) => x.userId === p.userId && x.eventId === occ.eventId);
    await tx.notificationDelivery.create({
      data: {
        notificationId: rows[0].id,
        toPhone: contact.phone,
        template: person && personCanClaim(person, occ) ? TEMPLATE_ALERT_CLAIM : TEMPLATE_ALERT,
      },
    });
  }
  return created;
}

/** 1. Fila de mudanças → avisos. */
export async function processOutbox({ db, now = () => new Date() }: DispatchDeps): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM occurrence_changes WHERE processed_at IS NULL
         ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const ids = locked.map((r) => r.id);
      const changes = await tx.occurrenceChange.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
      const occs = await tx.occurrence.findMany({
        where: { id: { in: [...new Set(changes.map((c) => c.occurrenceId))] } },
        select: occSelect,
      });
      const byId = new Map(occs.map((o) => [o.id, toInfo(o)]));
      const people = await loadPeople(tx, [...new Set(occs.map((o) => o.eventId))]);
      let created = 0;
      for (const c of changes) {
        const occ = byId.get(c.occurrenceId);
        if (!occ) continue;
        const change: Change = {
          id: c.id, kind: c.kind as Change["kind"], actorUserId: c.actorUserId,
          old: c.old as Snapshot | null, new: c.new as unknown as Snapshot,
        };
        created += await store(tx, planForChange(change, occ, people), occ, people);
      }
      await tx.occurrenceChange.updateMany({ where: { id: { in: ids } }, data: { processedAt: now() } });
      return created;
    }, { timeout: 30_000 });
    if (result === null) return total;
    total += result;
  }
}

/** 2. SLA: perto de vencer (20% do prazo ou 5 min, o que for maior) e vencido. */
export async function scanSla({ db, now = () => new Date() }: DispatchDeps): Promise<number> {
  const at = now();
  return db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM occurrences
       WHERE status NOT IN ('CONCLUIDO', 'CANCELADO')
         AND sla_due_at IS NOT NULL
         AND sla_due_at - ${at}::timestamptz <= GREATEST(interval '5 minutes', (sla_due_at - opened_at) * 0.2)
       ORDER BY sla_due_at
       LIMIT 500`;
    if (due.length === 0) return 0;
    const occs = (await tx.occurrence.findMany({ where: { id: { in: due.map((d) => d.id) } }, select: occSelect })).map(toInfo);
    const people = await loadPeople(tx, [...new Set(occs.map((o) => o.eventId))]);
    let created = 0;
    for (const occ of occs) {
      const late = occ.slaDueAt!.getTime() <= at.getTime();
      created += await store(tx, planForSla(occ, people, late), occ, people);
    }
    return created;
  }, { timeout: 30_000 });
}

/**
 * 3. Urgente sem resposta. "Responder" é abrir o chamado (pelo botão do WhatsApp
 * ou pelo app, o que marca os avisos dele como lidos) ou mexer nele. Para quando
 * o chamado fecha ou deixa de ser urgente, e depois de 3 lembretes.
 */
export async function scanUrgentReminders({ db, now = () => new Date() }: DispatchDeps): Promise<number> {
  const at = now();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ user_id: string; occurrence_id: string; created_at: Date }[]>`
      SELECT n.user_id, n.occurrence_id, n.created_at
        FROM notifications n
        JOIN occurrences o ON o.id = n.occurrence_id
       WHERE n.type = 'URGENTE' AND n.read_at IS NULL
         AND n.dedupe_key = 'urgente:' || n.occurrence_id::text
         AND n.created_at <= ${at}::timestamptz - ${REMINDER_EVERY_MS}::int * interval '1 millisecond'
         AND n.created_at > ${at}::timestamptz - ${REMINDER_EVERY_MS * (MAX_REMINDERS + 1)}::int * interval '1 millisecond'
         AND o.status NOT IN ('CONCLUIDO', 'CANCELADO')
         AND (o.status = 'URGENTE' OR o.priority = 'CRITICA')
         AND NOT EXISTS (
           SELECT 1 FROM notifications r
            WHERE r.user_id = n.user_id AND r.occurrence_id = n.occurrence_id
              AND r.read_at IS NOT NULL AND r.created_at >= n.created_at)
         AND NOT EXISTS (
           SELECT 1 FROM occurrence_changes c
            WHERE c.occurrence_id = n.occurrence_id AND c.actor_user_id = n.user_id
              AND c.created_at >= n.created_at)
       ORDER BY n.created_at
       LIMIT 500`;
    if (rows.length === 0) return 0;
    const occs = (await tx.occurrence.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.occurrence_id))] } }, select: occSelect,
    })).map(toInfo);
    const byId = new Map(occs.map((o) => [o.id, o]));
    const people = await loadPeople(tx, [...new Set(occs.map((o) => o.eventId))]);
    let created = 0;
    for (const r of rows) {
      const occ = byId.get(r.occurrence_id);
      if (!occ) continue;
      const n = Math.floor((at.getTime() - r.created_at.getTime()) / REMINDER_EVERY_MS);
      created += await store(tx, planUrgentReminder(occ, people, r.user_id, n), occ, people);
    }
    return created;
  }, { timeout: 30_000 });
}

export function appUrl() {
  return publicUrl();
}

/** 4. Envio pelo WhatsApp, com até 4 tentativas. */
export async function sendPending({ db, whatsapp, now = () => new Date() }: DispatchDeps): Promise<{ sent: number; skipped: number; failed: number }> {
  const stats = { sent: 0, skipped: 0, failed: 0 };
  if (!whatsapp) return stats;
  // Em lotes de 20, até esvaziar (com limite por rodada).
  for (let batch = 0; batch < 25; batch++) {
    const at = now();
    // Reserva os envios (os outros despachos pulam estes por 2 minutos).
    const claimed = await db.$queryRaw<{ id: string; attempts: number }[]>`
      UPDATE notification_deliveries
         SET next_attempt_at = ${at}::timestamptz + interval '2 minutes', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM notification_deliveries
          WHERE status = 'PENDENTE' AND next_attempt_at <= ${at}::timestamptz
          ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING id, attempts`;

    for (const { id, attempts } of claimed) {
      const d = await db.notificationDelivery.findUniqueOrThrow({
        where: { id },
        include: { notification: { include: { user: { select: { active: true, whatsapp: true } } } } },
      });
      const n = d.notification;
      const skip = async (reason: string) => {
        stats.skipped++;
        await db.notificationDelivery.update({ where: { id }, data: { status: "IGNORADO", lastError: reason } });
      };

      if (n.readAt) { await skip("lido no app antes do envio"); continue; }
      if (at.getTime() - n.createdAt.getTime() > WHATSAPP_MAX_AGE_MS) { await skip("aviso antigo"); continue; }
      if (!n.user.active) { await skip("usuário inativo"); continue; }
      const contact = n.user.whatsapp;
      if (!contact?.optedInAt || contact.phone !== d.toPhone) { await skip("WhatsApp desligado ou número trocado"); continue; }
      if (!n.occurrenceId) { await skip("sem chamado"); continue; }

      // Reconfere o acesso agora: a pessoa pode ter mudado de equipe ou saído do evento.
      const o = await db.occurrence.findUnique({ where: { id: n.occurrenceId }, select: occSelect });
      const occ = o && toInfo(o);
      const person = occ && (await loadPeople(db as unknown as WTx, [occ.eventId])).find((p) => p.userId === n.userId);
      if (!occ || !person || !personCanSee(person, occ)) { await skip("sem acesso ao chamado"); continue; }

      const template = d.template === TEMPLATE_ALERT_CLAIM && personCanClaim(person, occ) ? TEMPLATE_ALERT_CLAIM : TEMPLATE_ALERT;
      try {
        const res = await whatsapp.sendTemplate({
          to: d.toPhone,
          template,
          body: [HEADLINE[n.type as NotificationType], String(occ.number), occ.title, n.body ?? `${occ.teamName} · ${occ.eventName}`],
          urlSuffix: occ.id,
          claimPayload: template === TEMPLATE_ALERT_CLAIM ? signClaim(d.id) : undefined,
        });
        stats.sent++;
        await db.notificationDelivery.update({
          where: { id },
          data: { status: "ENVIADO", template, providerMessageId: res.id || null, sentAt: now(), lastError: null },
        });
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        const final = attempts >= MAX_ATTEMPTS;
        if (final) stats.failed++;
        await db.notificationDelivery.update({
          where: { id },
          data: final
            ? { status: "FALHOU", lastError: message }
            : { lastError: message, nextAttemptAt: new Date(at.getTime() + RETRY_MINUTES[attempts - 1] * 60_000) },
        });
      }
    }
    if (claimed.length === 0) break;
  }
  return stats;
}

/** Fase 7A: avisos de prazo (7 dias, 3 dias, 48 horas, véspera) e do fim da montagem (só no app). */
async function scanDeadlines({ db, now = () => new Date() }: DispatchDeps) {
  const [r] = await db.$queryRaw<{ n: number }[]>`SELECT deadline_alerts(${now()}::timestamptz) AS n`;
  return r?.n ?? 0;
}

export async function dispatch(deps: DispatchDeps) {
  const created = await processOutbox(deps);
  const sla = await scanSla(deps);
  const reminders = await scanUrgentReminders(deps);
  const deadlines = await scanDeadlines(deps);
  const whatsapp = await sendPending(deps);
  return { created, sla, reminders, deadlines, whatsapp };
}
