-- ═══════════════════ Hierarquia de acessos, etapa 2 (Abu, 2026-10-21) ═══════════════════
-- 1. O diretor (Admin da agência) dá ao Head áreas correlacionadas: nelas o
--    Head enxerga e age como na área dele (head_areas + app.head_covers).
-- 2. O Pré-produtor pode ficar ligado a uma área. O Head que cobre essa área
--    marca as caixas dele, menos as de valores e do cliente (Painel executivo,
--    Orçamento, Fechamento financeiro e Atendimento), que seguem com o
--    Gerente de produção e o diretor.
-- Espelha src/server/authz/policy.ts (headCovers, canGrantSectionsFor).

-- CreateTable
CREATE TABLE "head_areas" (
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "head_areas_pkey" PRIMARY KEY ("participant_id","area_id")
);

CREATE INDEX "head_areas_event_id_idx" ON "head_areas"("event_id");

ALTER TABLE "head_areas" ADD CONSTRAINT "head_areas_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "head_areas" ADD CONSTRAINT "head_areas_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "head_areas" ADD CONSTRAINT "head_areas_event_id_area_id_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "head_areas" ADD CONSTRAINT "head_areas_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────── Quem cobre cada área ───────────────────────────

-- A pessoa logada é Head desta área, pela área dela ou por uma correlacionada?
CREATE FUNCTION app.head_covers(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_area IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'HEAD'
       AND (m.area_id = p_area
         OR EXISTS (SELECT 1 FROM head_areas h WHERE h.participant_id = m.participant_id AND h.area_id = p_area))
  )
$$;

-- Dar áreas correlacionadas ao Head: o diretor.
CREATE FUNCTION app.can_grant_head_areas(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event)
$$;

-- As caixas que o Head pode marcar (as de valores e do cliente ficam com o gestor).
CREATE FUNCTION app.head_sections() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY(SELECT s FROM unnest(app.all_sections()) s
                WHERE s NOT IN ('EXECUTIVO', 'ORCAMENTO', 'FINANCEIRO', 'ATENDIMENTO'))
$$;

-- Marcar as caixas deste Pré-produtor: o Gerente, o diretor ou o Head que cobre a área dele.
CREATE FUNCTION app.can_grant_sections_for(p_event uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.can_grant_sections(p_event) OR EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = p_participant AND p.event_id = p_event AND p.role = 'PRE_PRODUTOR'
       AND p.deleted_at IS NULL AND app.head_covers(p_event, p.area_id)
  )
$$;

REVOKE ALL ON FUNCTION app.head_covers(uuid, uuid), app.can_grant_head_areas(uuid), app.head_sections(),
  app.can_grant_sections_for(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.head_covers(uuid, uuid), app.can_grant_head_areas(uuid), app.head_sections(),
  app.can_grant_sections_for(uuid, uuid) TO core_app, core_worker;

-- Área correlacionada: só para Head, e diferente da área dele.
CREATE FUNCTION head_areas_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id AND p.role = 'HEAD'
       AND p.area_id IS DISTINCT FROM NEW.area_id
  ) THEN
    RAISE EXCEPTION 'área correlacionada é para Head, e diferente da área dele' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER head_areas_check BEFORE INSERT OR UPDATE ON head_areas
  FOR EACH ROW EXECUTE FUNCTION head_areas_check();

ALTER TABLE head_areas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON head_areas TO core_app;

CREATE POLICY app_select ON head_areas FOR SELECT TO core_app
  USING (app.is_event_admin(event_id) OR app.event_role(event_id) = 'GERENTE' OR app.is_me(event_id, participant_id));
CREATE POLICY app_insert ON head_areas FOR INSERT TO core_app
  WITH CHECK (app.can_grant_head_areas(event_id) AND granted_by = app.current_user_id());
CREATE POLICY app_delete ON head_areas FOR DELETE TO core_app
  USING (app.can_grant_head_areas(event_id));

-- ─────────────────── O Head age nas áreas que cobre ───────────────────

CREATE OR REPLACE FUNCTION app.can_assemble(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_send_to_field(p_event) OR app.head_covers(p_event, p_area)
$$;

CREATE OR REPLACE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO'))
  ) OR (p_role = 'OPERACIONAL' AND app.head_covers(p_event, p_area))
$$;

CREATE OR REPLACE FUNCTION app.can_edit_plan_point(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event)
      OR EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE')
      OR app.head_covers(p_event, p_area)
$$;

CREATE OR REPLACE FUNCTION app.can_give_function(p_event uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_field_person(p_event, p_participant) AND (
    app.has_section(p_event, '{FUNCOES}'::text[])
    OR EXISTS (
      SELECT 1 FROM participants p
       WHERE p.id = p_participant AND p.event_id = p_event
         AND p.role = 'OPERACIONAL' AND app.head_covers(p_event, p.area_id)
    )
  )
$$;

CREATE OR REPLACE FUNCTION app.can_manage_team(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event)
      OR EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE')
      OR app.head_covers(p_event, p_area)
$$;

CREATE OR REPLACE FUNCTION app.can_rate_supplier(p_event uuid, p_supplier uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (app.can_review_sla(p_event) AND app.is_agency_director((SELECT agency_id FROM events WHERE id = p_event)))
      OR EXISTS (
        SELECT 1
          FROM contracts c
          JOIN contract_items ci  ON ci.contract_id = c.id
          JOIN supplier_quotes sq ON sq.id = ci.quote_id
          JOIN quote_requests qr  ON qr.id = sq.request_id
          JOIN cost_items it      ON it.id = qr.cost_item_id AND it.area_id IS NOT NULL
         WHERE c.event_id = p_event AND c.supplier_id = p_supplier AND c.status = 'ASSINADO'
           AND app.head_covers(p_event, it.area_id)
      )
$$;

CREATE OR REPLACE FUNCTION app.can_see_arrival(p_event uuid, p_area uuid, p_responsible uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.has_section(p_event, '{MONTAGEM}'::text[]) OR app.is_event_admin(p_event)
      OR app.head_covers(p_event, p_area)
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role = 'GERENTE'
            OR (p_responsible IS NOT NULL AND m.participant_id = p_responsible AND m.role IN ('HEAD', 'OPERACIONAL'))
      )
$$;

CREATE OR REPLACE FUNCTION app.can_see_occurrence(p_event uuid, p_area uuid, p_team uuid, p_responsible uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR app.head_covers(p_event, p_area) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'OPERACIONAL' AND (m.team_id = p_team OR m.participant_id = p_responsible))
        OR (m.role = 'CLIENTE' AND app.client_can(p_event, 'progress'))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_participant(
  p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_event_admin(p_event)
      OR app.head_covers(p_event, p_area)
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
            OR (m.role = 'CLIENTE' AND app.client_can(p_event, 'team'))
            OR (m.role = 'HEAD' AND p_role = 'GERENTE')
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$$;

CREATE OR REPLACE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR app.head_covers(p_event, p_area) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
        OR (m.role = 'CLIENTE' AND (app.client_can(p_event, 'team') OR app.client_can(p_event, 'progress')))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_write_occurrence(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR app.head_covers(p_event, p_area) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$$;

CREATE OR REPLACE FUNCTION app.event_contracted_suppliers(p_event uuid)
RETURNS TABLE(supplier_id uuid, item_id uuid, item_name text, item_number integer, item_category item_category, area_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sq.supplier_id, ci.id, ci.name, ci.number, ci.category, ci.area_id
    FROM quote_requests qr
    JOIN supplier_quotes sq ON sq.id = qr.chosen_quote_id
    JOIN cost_items ci      ON ci.id = qr.cost_item_id
   WHERE qr.event_id = p_event AND qr.status = 'FECHADA'
     AND (app.can_review_sla(p_event) OR app.head_covers(p_event, ci.area_id))
   ORDER BY ci.number
$$;

CREATE OR REPLACE FUNCTION app.supplier_in_my_area(p_supplier uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM supplier_quotes sq
      JOIN quote_requests qr ON qr.id = sq.request_id AND qr.chosen_quote_id = sq.id AND qr.status = 'FECHADA'
      JOIN cost_items ci     ON ci.id = qr.cost_item_id AND ci.area_id IS NOT NULL
     WHERE sq.supplier_id = p_supplier
       AND app.head_covers(ci.event_id, ci.area_id)
  )
$$;

-- ─────────────────── Pré-produtor numa área ───────────────────

ALTER TABLE participants DROP CONSTRAINT participants_pre_produtor_event_level;
ALTER TABLE participants
  ADD CONSTRAINT participants_executivo_event_level
  CHECK (role <> 'PRODUTOR_EXECUTIVO' OR (area_id IS NULL AND team_id IS NULL));
ALTER TABLE participants
  ADD CONSTRAINT participants_pre_produtor_no_team
  CHECK (role <> 'PRE_PRODUTOR' OR team_id IS NULL);

-- ─────────────────── O Head marca as caixas dos produtores da área ───────────────────

CREATE OR REPLACE FUNCTION producer_access_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_kept text[] := ARRAY['EXECUTIVO', 'ORCAMENTO', 'FINANCEIRO', 'ATENDIMENTO'];
  v_old text[];
BEGIN
  -- No INSERT ... ON CONFLICT (upsert), a linha que já existe vale como a anterior.
  v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.sections
           ELSE coalesce((SELECT a.sections FROM producer_access a WHERE a.participant_id = NEW.participant_id), ARRAY[]::text[]) END;
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id AND p.role = 'PRE_PRODUTOR'
  ) THEN
    RAISE EXCEPTION 'as caixas de acesso valem só para Pré-produtor' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.sections <@ app.all_sections() THEN
    RAISE EXCEPTION 'parte da Pré-produção desconhecida' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.participant_id <> OLD.participant_id OR NEW.event_id <> OLD.event_id) THEN
    RAISE EXCEPTION 'não é possível mover as caixas para outra pessoa' USING ERRCODE = 'check_violation';
  END IF;
  -- O Head não mexe nas caixas de valores e do cliente.
  IF app.current_user_id() IS NOT NULL AND NOT app.can_grant_sections(NEW.event_id) THEN
    IF NOT (
      ARRAY(SELECT s FROM unnest(NEW.sections) s WHERE s = ANY (v_kept) ORDER BY s)
      = ARRAY(SELECT s FROM unnest(v_old) s WHERE s = ANY (v_kept) ORDER BY s)
    ) THEN
      RAISE EXCEPTION 'Painel executivo, Orçamento, Fechamento financeiro e Atendimento são liberados pelo Gerente de produção ou pelo diretor'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO NEW.sections FROM unnest(NEW.sections) s;
  NEW.sections := coalesce(NEW.sections, ARRAY[]::text[]);
  RETURN NEW;
END $$;

DROP POLICY app_select ON producer_access;
DROP POLICY app_insert ON producer_access;
DROP POLICY app_update ON producer_access;
CREATE POLICY app_select ON producer_access FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id)
         OR app.can_grant_sections_for(event_id, participant_id));
CREATE POLICY app_insert ON producer_access FOR INSERT TO core_app
  WITH CHECK (app.can_grant_sections_for(event_id, participant_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON producer_access FOR UPDATE TO core_app
  USING (app.can_grant_sections_for(event_id, participant_id))
  WITH CHECK (app.can_grant_sections_for(event_id, participant_id) AND updated_by = app.current_user_id());
