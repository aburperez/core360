import type { Actor } from "../../server/authz/actor";
import { canManageAreas, canUsePreProduction } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ConflictError, NotFoundError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { norm } from "../../server/xlsx";
import { requireEventAccess } from "../events/events.service";
import { DEFAULT_FUNCTIONS, sortActivities } from "./functions.service";
import { readFunctionsSheet, writeFunctionsSheet, type SheetActivity } from "./spreadsheet";

/**
 * Baixar e enviar a planilha de funções e áreas. O envio só cria e atualiza,
 * sempre comparando pelo nome; nunca apaga. Assim quem já tem uma função
 * continua com ela e as atividades marcadas como feitas continuam feitas.
 * Áreas e equipes só mudam para quem pode mexer nelas (Gerente); para o
 * Pré-produtor essa aba é ignorada. O banco confere de novo (RLS).
 */

function requirePre(actor: Actor, eventId: string) {
  requireEventAccess(actor, eventId);
  if (!canUsePreProduction(actor, eventId)) throw new NotFoundError("Pré-produção");
}

const toDate = (day: string | null) => (day ? new Date(`${day}T00:00:00.000Z`) : null);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function exportFunctionsSheet(actor: Actor, eventId: string) {
  requirePre(actor, eventId);
  const data = await actor.run(async (tx) => {
    const [event, areas, functions, activities] = await Promise.all([
      tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } }),
      tx.area.findMany({
        where: { eventId, deletedAt: null },
        orderBy: { name: "asc" },
        select: {
          name: true, description: true,
          teams: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { name: true, description: true } },
        },
      }),
      tx.eventFunction.findMany({ where: { eventId }, select: { id: true, name: true, description: true } }),
      tx.activity.findMany({
        where: { eventId, functionId: { not: null } },
        select: { title: true, day: true, startTime: true, endTime: true, place: true, function: { select: { name: true } } },
      }),
    ]);
    return { event, areas, functions, activities };
  });

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");
  const functions = data.functions.length
    ? data.functions.map(({ name, description }) => ({ name, description })).sort(byName)
    : DEFAULT_FUNCTIONS.map((name) => ({ name, description: null }));
  const activities = sortActivities(
    data.activities.map((a) => ({
      functionName: a.function!.name, title: a.title, day: fromDate(a.day), startTime: a.startTime, endTime: a.endTime, place: a.place,
    })),
  ).sort((a, b) => a.functionName.localeCompare(b.functionName, "pt-BR"));

  const bytes = await writeFunctionsSheet({
    eventName: data.event.name,
    areas: data.areas,
    functions,
    activities,
    canEditAreas: canManageAreas(actor, eventId),
  });
  return { fileName: `Funcoes e areas - ${data.event.name}.xlsx`, bytes };
}

type Change = { create: string[]; update: string[] };
const change = (): Change => ({ create: [], update: [] });
const LIST_MAX = 30;

/** Para a prévia: os primeiros nomes e quantos são no total. */
const summary = (c: Change) => ({
  create: c.create.length, update: c.update.length,
  createNames: c.create.slice(0, LIST_MAX), updateNames: c.update.slice(0, LIST_MAX),
});

export async function importFunctionsSheet(actor: Actor, eventId: string, bytes: Uint8Array, opts: { confirm: boolean }) {
  requirePre(actor, eventId);
  const sheet = await readFunctionsSheet(bytes);
  const warnings = [...sheet.warnings];
  const manageAreas = canManageAreas(actor, eventId);

  try {
    return await actor.run(async (tx) => {
      const [areas, functions, activities] = await Promise.all([
        tx.area.findMany({
          where: { eventId, deletedAt: null },
          select: { id: true, name: true, description: true, teams: { where: { deletedAt: null }, select: { id: true, name: true, description: true } } },
        }),
        tx.eventFunction.findMany({ where: { eventId }, select: { id: true, name: true, description: true } }),
        tx.activity.findMany({
          where: { eventId, functionId: { not: null } },
          select: { id: true, functionId: true, title: true, day: true, startTime: true, endTime: true, place: true },
        }),
      ]);

      // ── Áreas e equipes ──
      const areaChanges = change();
      const teamChanges = change();
      const areaPlan: { id: string | null; name: string; description: string | null; update: boolean; teams: { id: string | null; name: string; description: string | null }[] }[] = [];
      for (const a of sheet.areas ?? []) {
        const found = areas.find((x) => norm(x.name) === norm(a.name));
        const update = !!found && !!a.description && a.description !== found.description;
        if (!found) areaChanges.create.push(a.name);
        else if (update) areaChanges.update.push(found.name);
        const label = found?.name ?? a.name;
        const teams = [];
        for (const t of a.teams) {
          const ft = found?.teams.find((x) => norm(x.name) === norm(t.name));
          if (!ft) {
            teamChanges.create.push(`${label} › ${t.name}`);
            teams.push({ id: null, name: t.name, description: t.description });
          } else if (t.description && t.description !== ft.description) {
            teamChanges.update.push(`${label} › ${ft.name}`);
            teams.push({ id: ft.id, name: ft.name, description: t.description });
          }
        }
        if (!found || update || teams.length) areaPlan.push({ id: found?.id ?? null, name: a.name, description: a.description, update, teams });
      }
      const areaChangeCount = areaChanges.create.length + areaChanges.update.length + teamChanges.create.length + teamChanges.update.length;
      const ignoredAreas = !manageAreas && areaChangeCount > 0;
      if (ignoredAreas) {
        warnings.unshift("A aba Áreas e equipes foi ignorada: só o Gerente do evento muda áreas e equipes.");
      }

      // ── Funções ──
      const fnChanges = change();
      const fnByNorm = new Map(functions.map((f) => [norm(f.name), f]));
      const fnCreate: { name: string; description: string | null }[] = [];
      const fnUpdate: { id: string; description: string }[] = [];
      for (const f of sheet.functions ?? []) {
        const found = fnByNorm.get(norm(f.name));
        if (!found) {
          fnChanges.create.push(f.name);
          fnCreate.push(f);
        } else if (f.description && f.description !== found.description) {
          fnChanges.update.push(found.name);
          fnUpdate.push({ id: found.id, description: f.description });
        }
      }
      const willExist = new Set([...fnByNorm.keys(), ...fnCreate.map((f) => norm(f.name))]);

      // ── Atividades (de cada função) ──
      const actCreate: SheetActivity[] = [];
      const actUpdate: { id: string; data: { startTime?: string; endTime?: string; place?: string } }[] = [];
      const missingFns = new Set<string>();
      for (const a of sheet.activities ?? []) {
        const key = norm(a.functionName);
        if (!willExist.has(key)) {
          missingFns.add(a.functionName);
          continue;
        }
        const fn = fnByNorm.get(key);
        const found = fn && activities.find((x) => x.functionId === fn.id && norm(x.title) === norm(a.title) && fromDate(x.day) === a.day);
        if (!found) {
          actCreate.push(a);
          continue;
        }
        const data: { startTime?: string; endTime?: string; place?: string } = {};
        if (a.startTime && a.startTime !== found.startTime) data.startTime = a.startTime;
        if (a.endTime && a.endTime !== found.endTime) data.endTime = a.endTime;
        if (a.place && a.place !== found.place) data.place = a.place;
        const start = data.startTime ?? found.startTime;
        const end = data.endTime ?? found.endTime;
        if (end && (!start || end < start)) {
          warnings.push(`Atividades: "${a.title}" (${a.functionName}) ficaria com o fim antes do início; não foi alterada.`);
          continue;
        }
        if (Object.keys(data).length) actUpdate.push({ id: found.id, data });
      }
      for (const name of missingFns) {
        warnings.push(`Atividades: a função "${name}" não existe no app nem na aba Funções; as atividades dela foram ignoradas.`);
      }

      const preview = {
        areas: summary(ignoredAreas ? change() : areaChanges),
        teams: summary(ignoredAreas ? change() : teamChanges),
        functions: summary(fnChanges),
        activities: { create: actCreate.length, update: actUpdate.length },
        ignoredAreas,
        tabs: { areas: sheet.areas !== null, functions: sheet.functions !== null, activities: sheet.activities !== null },
        warnings: warnings.slice(0, 50),
        moreWarnings: Math.max(0, warnings.length - 50),
      };
      const nothing =
        (ignoredAreas ? 0 : areaChangeCount) + fnCreate.length + fnUpdate.length + actCreate.length + actUpdate.length === 0;
      if (!opts.confirm || nothing) return { ...preview, nothing, saved: false };

      // ── Gravar ──
      if (!ignoredAreas) {
        for (const a of areaPlan) {
          let areaId = a.id;
          if (!areaId) {
            areaId = (await tx.area.create({ data: { eventId, name: a.name, description: a.description }, select: { id: true } })).id;
          } else if (a.update) {
            await tx.area.update({ where: { id: areaId }, data: { description: a.description } });
          }
          for (const t of a.teams) {
            if (t.id) await tx.team.update({ where: { id: t.id }, data: { description: t.description } });
            else await tx.team.create({ data: { eventId, areaId, name: t.name, description: t.description } });
          }
        }
      }
      const created = fnCreate.length
        ? await tx.eventFunction.createManyAndReturn({
            data: fnCreate.map((f) => ({ eventId, name: f.name, description: f.description, createdById: actor.userId })),
            select: { id: true, name: true },
          })
        : [];
      for (const f of fnUpdate) await tx.eventFunction.update({ where: { id: f.id }, data: { description: f.description } });
      const fnId = new Map([...functions, ...created].map((f) => [norm(f.name), f.id]));
      if (actCreate.length) {
        await tx.activity.createMany({
          data: actCreate.map((a) => ({
            eventId, functionId: fnId.get(norm(a.functionName))!, createdById: actor.userId,
            title: a.title, day: toDate(a.day), startTime: a.startTime, endTime: a.endTime, place: a.place,
          })),
        });
      }
      for (const a of actUpdate) await tx.activity.update({ where: { id: a.id }, data: a.data });

      await audit(tx, actor, {
        eventId, entity: "functions_sheet", action: "CREATE",
        after: {
          areas: ignoredAreas ? null : { create: areaChanges.create, update: areaChanges.update },
          teams: ignoredAreas ? null : { create: teamChanges.create, update: teamChanges.update },
          functions: { create: fnChanges.create, update: fnChanges.update },
          activities: preview.activities,
        },
      });
      return { ...preview, nothing, saved: true };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Alguém mudou as funções ou as áreas ao mesmo tempo. Envie a planilha de novo.");
    throw e;
  }
}
