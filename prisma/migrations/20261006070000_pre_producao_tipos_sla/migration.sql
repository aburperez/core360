-- CORE 360 — Pré-produção, etapa 1: tipos de atendimento, SLA por atividade
-- (proposto por quem executa, revisto pelo gestor com comentário) e a planilha
-- "quem faz o quê". O chamado pode apontar para um tipo da MESMA equipe.

-- CreateEnum
CREATE TYPE "sla_proposal_status" AS ENUM ('PENDENTE', 'APROVADA', 'AJUSTADA', 'RECUSADA');

-- AlterTable
ALTER TABLE "occurrences" ADD COLUMN     "service_type_id" UUID;

-- CreateTable
CREATE TABLE "service_types" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sla_minutes" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_proposals" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "status" "sla_proposal_status" NOT NULL DEFAULT 'PENDENTE',
    "approved_minutes" INTEGER,
    "feedback" TEXT,
    "proposed_by" UUID NOT NULL,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sla_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_type_people" (
    "event_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "service_type_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_type_people_pkey" PRIMARY KEY ("service_type_id","participant_id")
);

-- CreateIndex
CREATE INDEX "service_types_event_id_area_id_team_id_idx" ON "service_types"("event_id", "area_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_types_event_id_area_id_team_id_id_key" ON "service_types"("event_id", "area_id", "team_id", "id");

-- CreateIndex
CREATE INDEX "sla_proposals_service_type_id_created_at_idx" ON "sla_proposals"("service_type_id", "created_at");

-- CreateIndex
CREATE INDEX "sla_proposals_event_id_status_idx" ON "sla_proposals"("event_id", "status");

-- CreateIndex
CREATE INDEX "service_type_people_event_id_participant_id_idx" ON "service_type_people"("event_id", "participant_id");

-- CreateIndex
CREATE INDEX "occurrences_service_type_id_idx" ON "occurrences"("service_type_id");

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_event_id_area_id_team_id_service_type_id_fkey" FOREIGN KEY ("event_id", "area_id", "team_id", "service_type_id") REFERENCES "service_types"("event_id", "area_id", "team_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_event_id_area_id_team_id_fkey" FOREIGN KEY ("event_id", "area_id", "team_id") REFERENCES "teams"("event_id", "area_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_types" ADD CONSTRAINT "service_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_proposals" ADD CONSTRAINT "sla_proposals_event_id_area_id_team_id_service_type_id_fkey" FOREIGN KEY ("event_id", "area_id", "team_id", "service_type_id") REFERENCES "service_types"("event_id", "area_id", "team_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_proposals" ADD CONSTRAINT "sla_proposals_proposed_by_fkey" FOREIGN KEY ("proposed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_proposals" ADD CONSTRAINT "sla_proposals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_people" ADD CONSTRAINT "service_type_people_event_id_area_id_team_id_service_type__fkey" FOREIGN KEY ("event_id", "area_id", "team_id", "service_type_id") REFERENCES "service_types"("event_id", "area_id", "team_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_type_people" ADD CONSTRAINT "service_type_people_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────── Regras de integridade ───────────────────────

ALTER TABLE service_types
  ADD CONSTRAINT service_types_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT service_types_sla_range CHECK (sla_minutes IS NULL OR sla_minutes BETWEEN 1 AND 43200);

-- Nome único por equipe entre os tipos ativos.
CREATE UNIQUE INDEX service_types_team_name_key
  ON service_types (team_id, lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE sla_proposals
  ADD CONSTRAINT sla_proposals_minutes_range CHECK (minutes BETWEEN 1 AND 43200),
  ADD CONSTRAINT sla_proposals_approved_range CHECK (approved_minutes IS NULL OR approved_minutes BETWEEN 1 AND 43200),
  -- Proposta revista tem revisor e data; aprovada/ajustada tem o prazo final;
  -- ajuste e recusa sempre vêm com o comentário do gestor.
  ADD CONSTRAINT sla_proposals_review_consistent CHECK (
    (status = 'PENDENTE' AND reviewed_by IS NULL AND reviewed_at IS NULL AND approved_minutes IS NULL)
    OR (status = 'APROVADA' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND approved_minutes = minutes)
    OR (status = 'AJUSTADA' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND approved_minutes IS NOT NULL
        AND nullif(btrim(feedback), '') IS NOT NULL)
    OR (status = 'RECUSADA' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND approved_minutes IS NULL
        AND nullif(btrim(feedback), '') IS NOT NULL)
  );

-- No máximo uma proposta aguardando por tipo.
CREATE UNIQUE INDEX sla_proposals_one_pending
  ON sla_proposals (service_type_id) WHERE status = 'PENDENTE';

-- Tipo não muda de evento, área ou equipe (as FKs compostas dependem disso).
CREATE FUNCTION service_types_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.event_id <> OLD.event_id OR NEW.area_id <> OLD.area_id
     OR NEW.team_id <> OLD.team_id OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'tipo de atendimento não muda de equipe' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER service_types_before_update
  BEFORE UPDATE ON service_types
  FOR EACH ROW EXECUTE FUNCTION service_types_before_update();

-- Proposta é revista uma vez só; o que foi proposto não muda depois.
CREATE FUNCTION sla_proposals_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'proposta de SLA já revista' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sla_proposals_before_update
  BEFORE UPDATE ON sla_proposals
  FOR EACH ROW EXECUTE FUNCTION sla_proposals_before_update();

-- Quem faz um tipo é alguém da mesma área do tipo.
CREATE FUNCTION service_type_people_check_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id
       AND p.area_id = NEW.area_id AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'pessoa fora da área do tipo de atendimento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION service_type_people_check_area() FROM PUBLIC;

CREATE TRIGGER service_type_people_check_area
  BEFORE INSERT ON service_type_people
  FOR EACH ROW EXECUTE FUNCTION service_type_people_check_area();

-- ─────────────────────── Acesso (RLS) ───────────────────────
-- Espelha src/server/authz/policy.ts (canManageServiceTypes, canProposeSla).

-- Gestor dos tipos e revisor do SLA: Gerente do evento ou Head da área.
CREATE FUNCTION app.can_manage_service_type(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE' OR (m.role = 'HEAD' AND m.area_id = p_area)
  )
$$;

-- Propor SLA: o gestor ou quem é da equipe que executa.
CREATE FUNCTION app.can_propose_sla(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_manage_service_type(p_event, p_area) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'OPERACIONAL' AND m.team_id = p_team
  )
$$;

REVOKE ALL ON FUNCTION app.can_manage_service_type(uuid, uuid), app.can_propose_sla(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_manage_service_type(uuid, uuid), app.can_propose_sla(uuid, uuid, uuid) TO core_app;

ALTER TABLE service_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_proposals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_type_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON service_types, sla_proposals, service_type_people FROM PUBLIC;

-- Tipos: quem enxerga a equipe enxerga os tipos dela; só o gestor cria e edita.
GRANT SELECT, INSERT, UPDATE ON service_types TO core_app;
CREATE POLICY app_select ON service_types FOR SELECT TO core_app
  USING (app.can_see_team(event_id, area_id, team_id));
CREATE POLICY app_insert ON service_types FOR INSERT TO core_app
  WITH CHECK (app.can_manage_service_type(event_id, area_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON service_types FOR UPDATE TO core_app
  USING (app.can_manage_service_type(event_id, area_id))
  WITH CHECK (app.can_manage_service_type(event_id, area_id));

-- Propostas: quem executa só propõe (sempre em nome próprio e aguardando);
-- só o gestor grava revisão. A revisão é feita por colunas específicas.
GRANT SELECT, INSERT ON sla_proposals TO core_app;
GRANT UPDATE (status, approved_minutes, feedback, reviewed_by, reviewed_at, updated_at) ON sla_proposals TO core_app;
CREATE POLICY app_select ON sla_proposals FOR SELECT TO core_app
  USING (app.can_see_team(event_id, area_id, team_id));
CREATE POLICY app_insert ON sla_proposals FOR INSERT TO core_app WITH CHECK (
  proposed_by = app.current_user_id()
  AND app.can_propose_sla(event_id, area_id, team_id)
  AND (
    (status = 'PENDENTE' AND reviewed_by IS NULL)
    OR (app.can_manage_service_type(event_id, area_id) AND reviewed_by = app.current_user_id())
  )
);
CREATE POLICY app_update ON sla_proposals FOR UPDATE TO core_app
  USING (app.can_manage_service_type(event_id, area_id))
  WITH CHECK (app.can_manage_service_type(event_id, area_id) AND reviewed_by = app.current_user_id());

-- Quem faz o quê: marcar e desmarcar é do gestor. É a única tabela de negócio
-- em que o app apaga linhas: é uma marcação, não um registro (fica na auditoria).
GRANT SELECT, INSERT, DELETE ON service_type_people TO core_app;
CREATE POLICY app_select ON service_type_people FOR SELECT TO core_app
  USING (app.can_see_team(event_id, area_id, team_id));
CREATE POLICY app_insert ON service_type_people FOR INSERT TO core_app
  WITH CHECK (app.can_manage_service_type(event_id, area_id));
CREATE POLICY app_delete ON service_type_people FOR DELETE TO core_app
  USING (app.can_manage_service_type(event_id, area_id));
