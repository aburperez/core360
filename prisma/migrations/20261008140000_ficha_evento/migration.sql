-- Ficha completa do evento (fase 1 do roadmap, aprovada pelo Abu em 2026-10-08).
--   • As 11 etapas do evento: Briefing, Planejamento, Orçamento, Aprovação,
--     Contratação, Pré-produção, Montagem, Evento, Desmontagem, Fechamento e
--     Concluído (mais Cancelado). Os eventos de hoje mudam sozinhos: Operação
--     vira Evento e Finalizado vira Concluído (RENAME VALUE: nada é recriado).
--   • Campos novos da ficha. Orçamento aprovado e centro de custo ficam numa
--     tabela à parte, que só a Pré-produção e o Admin leem.
--   • Responsável geral e produtor: Gerente ou Pré-produtor ativo do evento.

-- AlterEnum (cada comando vale sozinho; o valor novo só é usado depois)
ALTER TYPE "event_status" RENAME VALUE 'OPERACAO' TO 'EVENTO';
ALTER TYPE "event_status" RENAME VALUE 'FINALIZADO' TO 'CONCLUIDO';
ALTER TYPE "event_status" ADD VALUE 'BRIEFING' BEFORE 'PLANEJAMENTO';
ALTER TYPE "event_status" ADD VALUE 'ORCAMENTO' AFTER 'PLANEJAMENTO';
ALTER TYPE "event_status" ADD VALUE 'APROVACAO' AFTER 'ORCAMENTO';
ALTER TYPE "event_status" ADD VALUE 'CONTRATACAO' AFTER 'APROVACAO';
ALTER TYPE "event_status" ADD VALUE 'FECHAMENTO' AFTER 'DESMONTAGEM';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "city" TEXT,
ADD COLUMN     "event_type" TEXT,
ADD COLUMN     "expected_audience" INTEGER,
ADD COLUMN     "lead_id" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "producer_id" UUID,
ADD COLUMN     "project" TEXT,
ADD COLUMN     "setup_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "setup_starts_at" TIMESTAMPTZ(3),
ADD COLUMN     "state" TEXT,
ADD COLUMN     "teardown_ends_at" TIMESTAMPTZ(3),
ADD COLUMN     "teardown_starts_at" TIMESTAMPTZ(3),
ALTER COLUMN "status" SET DEFAULT 'BRIEFING';

-- CreateTable
CREATE TABLE "event_finances" (
    "event_id" UUID NOT NULL,
    "approved_budget" DECIMAL(14,2),
    "cost_center" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_finances_pkey" PRIMARY KEY ("event_id")
);

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_lead_fkey" FOREIGN KEY ("id", "lead_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_producer_fkey" FOREIGN KEY ("id", "producer_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_finances" ADD CONSTRAINT "event_finances_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE events
  ADD CONSTRAINT events_state_uf CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT events_audience CHECK (expected_audience IS NULL OR expected_audience >= 0),
  ADD CONSTRAINT events_setup_period CHECK (setup_starts_at IS NULL OR setup_ends_at IS NULL OR setup_ends_at >= setup_starts_at),
  ADD CONSTRAINT events_teardown_period CHECK (teardown_starts_at IS NULL OR teardown_ends_at IS NULL OR teardown_ends_at >= teardown_starts_at);

ALTER TABLE event_finances
  ADD CONSTRAINT event_finances_budget CHECK (approved_budget IS NULL OR approved_budget >= 0);

-- Responsável geral e produtor: Gerente ou Pré-produtor ativo deste evento.
CREATE FUNCTION events_check_people() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.lead_id IS NOT NULL AND NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NOT EXISTS (
        SELECT 1 FROM participants p WHERE p.id = NEW.lead_id AND p.event_id = NEW.id
           AND p.role IN ('GERENTE', 'PRE_PRODUTOR') AND p.active AND p.deleted_at IS NULL))
     OR (NEW.producer_id IS NOT NULL AND NEW.producer_id IS DISTINCT FROM OLD.producer_id AND NOT EXISTS (
        SELECT 1 FROM participants p WHERE p.id = NEW.producer_id AND p.event_id = NEW.id
           AND p.role IN ('GERENTE', 'PRE_PRODUTOR') AND p.active AND p.deleted_at IS NULL))
  THEN
    RAISE EXCEPTION 'o responsável geral e o produtor precisam ser Gerente ou Pré-produtor do evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION events_check_people() FROM PUBLIC;

CREATE TRIGGER events_check_people
  BEFORE UPDATE OF lead_id, producer_id ON events
  FOR EACH ROW EXECUTE FUNCTION events_check_people();

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Valores: a Pré-produção (Gerente, Pré-produtor, Admin) lê; o gestor grava.
ALTER TABLE event_finances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_finances FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON event_finances TO core_app;

CREATE POLICY app_select ON event_finances FOR SELECT TO core_app USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON event_finances FOR INSERT TO core_app
  WITH CHECK (app.can_review_sla(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON event_finances FOR UPDATE TO core_app
  USING (app.can_review_sla(event_id)) WITH CHECK (app.can_review_sla(event_id) AND updated_by = app.current_user_id());

-- "Aberto" (diretor entra como Gerente): tudo o que não está Concluído nem Cancelado.
CREATE OR REPLACE FUNCTION app.event_is_open(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM events
     WHERE id = p_event AND deleted_at IS NULL AND status NOT IN ('CONCLUIDO', 'CANCELADO')
  )
$$;

CREATE OR REPLACE FUNCTION directors_join_events_for(p_director uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT ev.id FROM events ev JOIN directors d ON d.agency_id = ev.agency_id
            WHERE d.id = p_director AND ev.deleted_at IS NULL AND ev.status NOT IN ('CONCLUIDO', 'CANCELADO') LOOP
    PERFORM app.director_join(p_director, e.id);
  END LOOP;
END
$$;
