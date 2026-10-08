import { isEventAdmin, type Actor } from "../../server/authz/actor";
import { canAssignRole, canGrantClientView, canManageAreas, canReviewSla, canUsePreProduction } from "../../server/authz/policy";
import { audit } from "../../server/audit/audit";
import { ConflictError, NotFoundError } from "../../server/errors";
import { isUniqueViolation } from "../../server/db/errors";
import { norm } from "../../server/xlsx";
import { requireEventAccess } from "../events/events.service";
import { DEFAULT_FUNCTIONS, isDefaultFunctionName, setFunction, sortActivities } from "./functions.service";
import {
  NO_FUNCTION, ROLE_NAMES, readFunctionsSheet, viewText, writeFunctionsSheet,
  type SheetActivity, type SheetRole, type SheetView,
} from "./spreadsheet";

/**
 * Baixar e enviar a planilha de funções e áreas. O envio só cria e atualiza,
 * sempre comparando pelo nome; nunca apaga. Assim quem já tem uma função
 * continua com ela e as atividades marcadas como feitas continuam feitas.
 * Áreas e equipes só mudam para quem pode mexer nelas (Gerente); para o
 * Pré-produtor essa aba é ignorada. O banco confere de novo (RLS).
 *
 * Aba Pessoas: só quem já está no evento, achado pelo e-mail. O Gerente muda
 * perfil, área, equipe e a visão do Cliente; a Pré-produção muda a função.
 * Ninguém é apagado nem desativado por aqui.
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
    const [event, areas, functions, activities, people] = await Promise.all([
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
      tx.participant.findMany({
        where: { eventId, active: true, deletedAt: null },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        select: {
          name: true, email: true, phone: true, role: true, company: true, directManager: true,
          area: { select: { name: true } }, team: { select: { name: true } },
          profile: { select: { function: { select: { name: true } } } },
          clientView: { select: { costs: true, team: true, progress: true } },
        },
      }),
    ]);
    return { event, areas, functions, activities, people };
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
    people: data.people.map((p) => ({
      name: p.name, email: p.email, phone: p.phone, area: p.area?.name ?? null, team: p.team?.name ?? null, role: p.role,
      functionName: p.profile?.function?.name ?? null,
      company: p.company, directManager: p.directManager,
      view: p.role === "CLIENTE" ? (p.clientView ?? NO_VIEW) : null,
    })),
    canEditPeople: canEditPeople(actor, eventId),
    canGrantClientView: canGrantClientView(actor, eventId),
  });
  return { fileName: `Funcoes e areas - ${data.event.name}.xlsx`, bytes };
}

const NO_VIEW: SheetView = { costs: false, team: false, progress: false };
const FIELD: SheetRole[] = ["GERENTE", "HEAD", "OPERACIONAL"];
const EVENT_LEVEL: SheetRole[] = ["GERENTE", "CLIENTE", "PRE_PRODUTOR"];
/** Perfil, área e equipe pela planilha: quem monta a equipe do evento inteiro (Gerente). */
const canEditPeople = (actor: Actor, eventId: string) => canManageAreas(actor, eventId);
const sameView = (a: SheetView, b: SheetView) => a.costs === b.costs && a.team === b.team && a.progress === b.progress;

type PersonPlan = {
  id: string;
  label: string;
  before: { role: SheetRole; areaId: string | null; teamId: string | null };
  /** Novo lugar, pelo nome (a área pode ser criada nesta mesma planilha). */
  placement?: { role: SheetRole; area: string | null; team: string | null };
  functionId?: string | null;
  /** Nome da função (pode ser criada nesta mesma planilha). */
  functionName?: string | null;
  view?: SheetView;
  work?: { company?: string | null; directManager?: string | null };
  changes: string[];
};

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
      // Função fora da lista padrão é só do diretor de produção: para os outros
      // a planilha cria as da lista e avisa quais ficaram de fora.
      const canCustom = canReviewSla(actor, eventId);
      const ignoredFns: string[] = [];
      for (const f of sheet.functions ?? []) {
        const found = fnByNorm.get(norm(f.name));
        if (!found) {
          if (!canCustom && !isDefaultFunctionName(f.name)) {
            ignoredFns.push(f.name);
            continue;
          }
          fnChanges.create.push(f.name);
          fnCreate.push(f);
        } else if (f.description && f.description !== found.description) {
          fnChanges.update.push(found.name);
          fnUpdate.push({ id: found.id, description: f.description });
        }
      }
      const willExist = new Set([...fnByNorm.keys(), ...fnCreate.map((f) => norm(f.name))]);
      if (ignoredFns.length) {
        warnings.unshift(
          `Só o diretor de produção cria funções fora da lista padrão. ${ignoredFns.length === 1 ? "Ficou" : "Ficaram"} de fora: ${ignoredFns.join(", ")}.`,
        );
      }

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

      // ── Pessoas ──
      const peoplePlan: PersonPlan[] = [];
      if (sheet.people) {
        const current = await tx.participant.findMany({
          where: { eventId, active: true, deletedAt: null },
          select: {
            id: true, name: true, email: true, role: true, areaId: true, teamId: true, userId: true, directorId: true,
            company: true, directManager: true,
            profile: { select: { functionId: true } },
            clientView: { select: { costs: true, team: true, progress: true } },
          },
        });
        const byEmail = new Map(current.map((p) => [p.email.toLowerCase(), p]));
        const editPeople = canEditPeople(actor, eventId);
        const grantView = canGrantClientView(actor, eventId);
        const admin = isEventAdmin(actor, eventId);
        // Áreas e equipes que existem ou que esta planilha cria.
        const areaNames = new Map<string, { name: string; teams: Map<string, string> }>();
        for (const a of areas) areaNames.set(norm(a.name), { name: a.name, teams: new Map(a.teams.map((t) => [norm(t.name), t.name])) });
        if (!ignoredAreas) {
          for (const a of areaPlan) {
            const e = areaNames.get(norm(a.name)) ?? { name: a.name, teams: new Map<string, string>() };
            a.teams.forEach((t) => e.teams.has(norm(t.name)) || e.teams.set(norm(t.name), t.name));
            areaNames.set(norm(a.name), e);
          }
        }
        const areaOf = (id: string | null) => areas.find((a) => a.id === id);
        const fnName = new Map(functions.map((f) => [f.id, f.name]));
        let notFound = 0;
        let ignoredPlacement = 0;
        let ignoredView = 0;
        let ignoredWork = 0;

        for (const row of sheet.people) {
          const cur = byEmail.get(row.email);
          if (!cur) {
            if (++notFound <= 5) warnings.push(`${row.where}: ${row.email} não está neste evento; cadastre em Montar equipe.`);
            continue;
          }
          const plan: PersonPlan = { id: cur.id, label: cur.name, before: { role: cur.role, areaId: cur.areaId, teamId: cur.teamId }, changes: [] };
          const curArea = areaOf(cur.areaId);
          const curAreaName = curArea?.name ?? null;
          const curTeamName = curArea?.teams.find((t) => t.id === cur.teamId)?.name ?? null;

          // Perfil, área e equipe.
          let role: SheetRole = cur.role;
          const wantRole = row.role ?? cur.role;
          let area = EVENT_LEVEL.includes(wantRole) ? null : (row.area ?? curAreaName);
          let team = wantRole === "OPERACIONAL" ? (row.team ?? curTeamName) : null;
          const moved = wantRole !== cur.role || norm(area ?? "") !== norm(curAreaName ?? "") || norm(team ?? "") !== norm(curTeamName ?? "");
          const skip = (why: string) => warnings.push(`${row.where} (${cur.name}): ${why}; perfil, área e equipe não mudam.`);
          if (moved) {
            const areaHit = area ? areaNames.get(norm(area)) : undefined;
            if (!editPeople) ignoredPlacement++;
            else if (cur.userId === actor.userId && !admin) skip("você não muda a sua própria participação");
            else if (cur.directorId) skip("é diretor de produção; ele é Gerente em todos os eventos");
            else if (wantRole === "HEAD" && !area) skip("Head precisa de uma área");
            else if (wantRole === "OPERACIONAL" && (!area || !team)) skip("Operacional precisa de área e equipe");
            else if (area && !areaHit) skip(`a área "${area}" não existe (crie na aba Áreas e equipes)`);
            else if (team && !areaHit!.teams.has(norm(team))) skip(`a equipe "${team}" não existe na área ${areaHit!.name}`);
            else if (
              !canAssignRole(actor, { eventId, areaId: cur.areaId, role: cur.role })
              || !canAssignRole(actor, { eventId, areaId: areas.find((a) => norm(a.name) === norm(area ?? ""))?.id ?? null, role: wantRole })
            ) skip(`você não pode pôr alguém como ${ROLE_NAMES[wantRole]}`);
            else {
              role = wantRole;
              area = areaHit?.name ?? null;
              team = team ? areaHit!.teams.get(norm(team))! : null;
              plan.placement = { role, area, team };
              const place = [area, team].filter(Boolean).join(" › ");
              plan.changes.push(role !== cur.role ? `perfil ${ROLE_NAMES[cur.role]} → ${ROLE_NAMES[role]}${place ? ` (${place})` : ""}` : `vai para ${place}`);
            }
          }

          // Função.
          if (row.functionName) {
            const none = norm(row.functionName) === norm(NO_FUNCTION);
            const key = norm(row.functionName);
            const curFn = cur.profile?.functionId ?? null;
            if (!FIELD.includes(role)) {
              if (!none) warnings.push(`${row.where} (${cur.name}): ${ROLE_NAMES[role]} não tem função; a função foi ignorada.`);
            } else if (!none && !willExist.has(key)) {
              warnings.push(`${row.where} (${cur.name}): a função "${row.functionName}" não existe no app nem na aba Funções; a função não muda.`);
            } else {
              const existing = fnByNorm.get(key);
              if (none ? curFn !== null : !existing || existing.id !== curFn) {
                plan.functionName = none ? null : (existing?.name ?? row.functionName);
                plan.functionId = none ? null : (existing?.id ?? undefined);
                plan.changes.push(none ? `sem função (era ${fnName.get(curFn!) ?? "?"})` : `função ${plan.functionName}`);
              }
            }
          }

          // Empresa e responsável direto: quem pode mexer na pessoa (como em Montar equipe).
          const work: { company?: string | null; directManager?: string | null } = {};
          if (row.company !== undefined && row.company !== cur.company) work.company = row.company;
          if (row.directManager !== undefined && row.directManager !== cur.directManager) work.directManager = row.directManager;
          if (Object.keys(work).length) {
            const canEdit = canAssignRole(actor, { eventId, areaId: cur.areaId, role: cur.role }) && (cur.userId !== actor.userId || admin);
            if (!canEdit) ignoredWork++;
            else {
              plan.work = work;
              if ("company" in work) plan.changes.push(work.company ? `empresa ${work.company}` : "sem empresa");
              if ("directManager" in work) plan.changes.push(work.directManager ? `responde a ${work.directManager}` : "sem responsável direto");
            }
          }

          // Visão do cliente.
          if (row.view) {
            if (!grantView) ignoredView++;
            else if (role !== "CLIENTE") warnings.push(`${row.where} (${cur.name}): a visão é só para o Cliente; foi ignorada.`);
            else if (!sameView(row.view, cur.clientView ?? NO_VIEW)) {
              plan.view = row.view;
              plan.changes.push(`vê ${viewText(row.view)}`);
            }
          }
          if (plan.changes.length) peoplePlan.push(plan);
        }
        if (notFound > 5) warnings.push(`Pessoas: mais ${notFound - 5} e-mails não estão neste evento.`);
        if (ignoredPlacement) warnings.unshift(`Pessoas: perfil, área e equipe foram ignorados em ${ignoredPlacement} ${ignoredPlacement === 1 ? "linha" : "linhas"}: só o Gerente do evento muda.`);
        if (ignoredWork) warnings.push(`Pessoas: empresa e responsável direto foram ignorados em ${ignoredWork} ${ignoredWork === 1 ? "linha" : "linhas"}: você não muda essas pessoas.`);
        if (ignoredView) warnings.push(`Pessoas: a visão do cliente foi ignorada: só o Gerente do evento libera.`);
      }

      const preview = {
        areas: summary(ignoredAreas ? change() : areaChanges),
        teams: summary(ignoredAreas ? change() : teamChanges),
        functions: summary(fnChanges),
        activities: { create: actCreate.length, update: actUpdate.length },
        people: summary({ create: [], update: peoplePlan.map((p) => `${p.label} (${p.changes.join("; ")})`) }),
        ignoredAreas,
        tabs: { people: sheet.people !== null, areas: sheet.areas !== null, functions: sheet.functions !== null, activities: sheet.activities !== null },
        warnings: warnings.slice(0, 50),
        moreWarnings: Math.max(0, warnings.length - 50),
      };
      const nothing =
        (ignoredAreas ? 0 : areaChangeCount) + fnCreate.length + fnUpdate.length + actCreate.length + actUpdate.length + peoplePlan.length === 0;
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

      // Pessoas: primeiro o lugar (a função e a visão dependem do perfil novo).
      if (peoplePlan.length) {
        const placed = await tx.area.findMany({
          where: { eventId, deletedAt: null },
          select: { id: true, name: true, teams: { where: { deletedAt: null }, select: { id: true, name: true } } },
        });
        for (const p of peoplePlan) {
          if (!p.placement) continue;
          const a = p.placement.area ? placed.find((x) => norm(x.name) === norm(p.placement!.area!)) : null;
          const t = a && p.placement.team ? a.teams.find((x) => norm(x.name) === norm(p.placement!.team!)) : null;
          const data = { role: p.placement.role, areaId: a?.id ?? null, teamId: t?.id ?? null };
          await tx.participant.update({ where: { id: p.id }, data });
          await audit(tx, actor, {
            eventId, entity: "participant", entityId: p.id, action: data.role !== p.before.role ? "ROLE_CHANGE" : "TEAM_CHANGE",
            before: p.before, after: data,
          });
        }
        for (const p of peoplePlan) {
          if (p.functionName === undefined) continue;
          const id = p.functionName === null ? null : (p.functionId ?? fnId.get(norm(p.functionName))!);
          const before = await setFunction(tx, eventId, p.id, id);
          await audit(tx, actor, {
            eventId, entity: "participant_profile", entityId: p.id, action: "ROLE_CHANGE", before: { functionId: before }, after: { functionId: id },
          });
        }
        for (const p of peoplePlan) {
          if (!p.work) continue;
          await tx.participant.update({ where: { id: p.id }, data: p.work });
          await audit(tx, actor, { eventId, entity: "participant", entityId: p.id, action: "UPDATE", after: p.work });
        }
        for (const p of peoplePlan) {
          if (!p.view) continue;
          await tx.clientView.upsert({
            where: { participantId: p.id },
            create: { eventId, participantId: p.id, ...p.view, updatedById: actor.userId },
            update: { ...p.view, updatedById: actor.userId },
          });
          await audit(tx, actor, { eventId, entity: "client_view", entityId: p.id, action: "UPDATE", after: { ...p.view } });
        }
      }

      await audit(tx, actor, {
        eventId, entity: "functions_sheet", action: "CREATE",
        after: {
          areas: ignoredAreas ? null : { create: areaChanges.create, update: areaChanges.update },
          teams: ignoredAreas ? null : { create: teamChanges.create, update: teamChanges.update },
          functions: { create: fnChanges.create, update: fnChanges.update },
          activities: preview.activities,
          people: peoplePlan.length,
        },
      });
      return { ...preview, nothing, saved: true };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("Alguém mudou as funções ou as áreas ao mesmo tempo. Envie a planilha de novo.");
    throw e;
  }
}
