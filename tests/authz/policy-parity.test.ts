import { afterAll, describe, expect, it } from "vitest";
import { actorFor, appDb, demo, type Person } from "../helpers";
import { withUser } from "@/server/db/with-user";
import {
  canAssignRole,
  canCreateOccurrence,
  canManageTeams,
  canReviewSla,
  canSendToField,
  canUsePreProduction,
  canSeeArea,
  canSeeOccurrence,
  canSeeTeam,
} from "@/server/authz/policy";

/**
 * A matriz do backend (src/server/authz/policy.ts) e a do banco (funções app.*
 * da RLS) precisam dar a MESMA resposta para todo papel × recurso. Se alguém
 * mudar uma e esquecer a outra, este teste quebra.
 */

const db = appDb();
const d = demo();
afterAll(() => db.$disconnect());

const PEOPLE: Person[] = ["admin", "marina", "paulo", "rafael", "beatriz", "claudia", "joao", "carlos", "ana", "sofia"];
const ROLES = ["GERENTE", "HEAD", "OPERACIONAL", "CLIENTE", "PRE_PRODUTOR"] as const;
const rock = d.events.rock.id;
const areas = [d.areas.infra.id, d.areas.ab.id];
const teams = [d.teams.eletrica, d.teams.cenografia, d.teams.bar];

describe("paridade backend × banco", () => {
  for (const person of PEOPLE) {
    it(person, async () => {
      const actor = await actorFor(db, person);
      const mismatches: string[] = [];
      const check = (label: string, ts: boolean, sql: boolean) => {
        if (ts !== sql) mismatches.push(`${label}: backend=${ts} banco=${sql}`);
      };

      await withUser(db, actor.userId, async (tx) => {
        const q = async (sql: string, ...args: unknown[]) =>
          ((await tx.$queryRawUnsafe<{ r: boolean }[]>(sql, ...args))[0].r);

        for (const areaId of areas) {
          for (const role of ROLES) {
            check(
              `atribuir ${role} na área ${areaId === d.areas.infra.id ? "Infra" : "A&B"}`,
              canAssignRole(actor, { eventId: rock, areaId, role }),
              await q(`SELECT app.can_assign_role($1::uuid, $2::participant_role, $3::uuid) AS r`, rock, role, areaId),
            );
          }
          check(`ver área ${areaId}`, canSeeArea(actor, { eventId: rock, areaId }),
            await q(`SELECT app.can_see_area($1::uuid, $2::uuid) AS r`, rock, areaId));
          check(`gerir equipes da área ${areaId}`, canManageTeams(actor, { eventId: rock, areaId }),
            await q(`SELECT app.can_manage_team($1::uuid, $2::uuid) AS r`, rock, areaId));

        }

        for (const t of teams) {
          const s = { eventId: rock, areaId: t.areaId, teamId: t.id };
          check(`ver equipe ${t.name}`, canSeeTeam(actor, s),
            await q(`SELECT app.can_see_team($1::uuid, $2::uuid, $3::uuid) AS r`, rock, t.areaId, t.id));
          check(`abrir ocorrência em ${t.name}`, canCreateOccurrence(actor, s),
            await q(`SELECT app.can_write_occurrence($1::uuid, $2::uuid, $3::uuid) AS r`, rock, t.areaId, t.id));
        }

        for (const ev of [rock, d.events.congresso.id]) {
          check(`usar a Pré-produção de ${ev}`, canUsePreProduction(actor, ev),
            await q(`SELECT app.can_use_pre_production($1::uuid) AS r`, ev));
          check(`rever SLA em ${ev}`, canReviewSla(actor, ev),
            await q(`SELECT app.can_review_sla($1::uuid) AS r`, ev));
          check(`enviar itens para o campo em ${ev}`, canSendToField(actor, ev),
            await q(`SELECT app.can_send_to_field($1::uuid) AS r`, ev));
        }

        for (const o of Object.values(d.occurrences)) {
          check(`ver ocorrência "${o.title}"`, canSeeOccurrence(actor, o),
            await q(`SELECT app.can_see_occurrence($1::uuid, $2::uuid, $3::uuid, $4::uuid) AS r`,
              o.eventId, o.areaId, o.teamId, o.responsibleParticipantId));
        }
      });

      expect(mismatches).toEqual([]);
    });
  }
});
