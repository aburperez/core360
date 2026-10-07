-- CreateTable
CREATE TABLE "client_views" (
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "costs" BOOLEAN NOT NULL DEFAULT false,
    "team" BOOLEAN NOT NULL DEFAULT false,
    "progress" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_views_pkey" PRIMARY KEY ("participant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_views_event_id_participant_id_key" ON "client_views"("event_id", "participant_id");

-- AddForeignKey
ALTER TABLE "client_views" ADD CONSTRAINT "client_views_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_views" ADD CONSTRAINT "client_views_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_views" ADD CONSTRAINT "client_views_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════ Visão do cliente ═══════════════════════════
-- O Cliente só olha. Não cria áreas, equipes nem pessoas, e vê só o que o
-- Gerente do evento (diretor ou executivo) ou o Admin liberar para ele:
-- custos, equipe e andamento (chamados e planta).

-- Só participação de Cliente tem visão de cliente.
CREATE FUNCTION client_views_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id AND p.role = 'CLIENTE'
  ) THEN
    RAISE EXCEPTION 'visão de cliente só vale para quem é Cliente no evento' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.participant_id <> OLD.participant_id OR NEW.event_id <> OLD.event_id) THEN
    RAISE EXCEPTION 'não é possível mover a visão para outra pessoa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER client_views_check BEFORE INSERT OR UPDATE ON client_views
  FOR EACH ROW EXECUTE FUNCTION client_views_check();

-- Quem libera a visão do cliente: o Gerente do evento ou o Admin.
CREATE FUNCTION app.can_grant_client_view(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

-- O usuário é Cliente neste evento (e não Admin dele).
CREATE FUNCTION app.is_client(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT app.is_event_admin(p_event) AND EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'CLIENTE'
  )
$$;

-- O Cliente tem esta parte liberada ('costs', 'team' ou 'progress')?
CREATE FUNCTION app.client_can(p_event uuid, p_view text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.membership(p_event) m
      JOIN client_views v ON v.participant_id = m.participant_id
     WHERE m.role = 'CLIENTE'
       AND CASE p_view WHEN 'costs' THEN v.costs WHEN 'team' THEN v.team WHEN 'progress' THEN v.progress ELSE false END
  )
$$;

-- Planta: o campo e o Cliente com o andamento liberado (só olhando).
CREATE FUNCTION app.can_see_plans(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_use_field(p_event) OR app.client_can(p_event, 'progress')
$$;

REVOKE ALL ON FUNCTION app.can_grant_client_view(uuid), app.is_client(uuid), app.client_can(uuid, text), app.can_see_plans(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_grant_client_view(uuid), app.is_client(uuid), app.client_can(uuid, text), app.can_see_plans(uuid) TO core_app;

ALTER TABLE client_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_views FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON client_views TO core_app;

CREATE POLICY app_select ON client_views FOR SELECT TO core_app USING (
  app.can_grant_client_view(event_id)
  OR EXISTS (SELECT 1 FROM app.membership(event_id) m WHERE m.participant_id = client_views.participant_id)
);
CREATE POLICY app_insert ON client_views FOR INSERT TO core_app
  WITH CHECK (app.can_grant_client_view(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON client_views FOR UPDATE TO core_app
  USING (app.can_grant_client_view(event_id))
  WITH CHECK (app.can_grant_client_view(event_id) AND updated_by = app.current_user_id());

-- ── O Cliente deixa de montar a equipe ──

CREATE OR REPLACE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE', 'PRE_PRODUTOR'))
        OR (m.role = 'HEAD'    AND p_role = 'OPERACIONAL' AND p_area = m.area_id)
  )
$$;

CREATE OR REPLACE FUNCTION app.can_manage_area(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

CREATE OR REPLACE FUNCTION app.can_manage_team(p_event uuid, p_area uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
  )
$$;

-- ── O que o Cliente vê depende do que foi liberado ──

CREATE OR REPLACE FUNCTION app.can_see_area(p_event uuid, p_area uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'HEAD', 'PRE_PRODUTOR')
        OR (m.role = 'OPERACIONAL' AND m.area_id = p_area)
        OR (m.role = 'CLIENTE' AND (app.client_can(p_event, 'team') OR app.client_can(p_event, 'progress')))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
        OR (m.role = 'CLIENTE' AND (app.client_can(p_event, 'team') OR app.client_can(p_event, 'progress')))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_participant(p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_event_admin(p_event)
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR')
            OR (m.role = 'CLIENTE' AND app.client_can(p_event, 'team'))
            OR (m.role = 'HEAD' AND (m.area_id = p_area OR p_role = 'GERENTE'))
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$$;

CREATE OR REPLACE FUNCTION app.can_see_occurrence(p_event uuid, p_area uuid, p_team uuid, p_responsible uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND (m.team_id = p_team OR m.participant_id = p_responsible))
        OR (m.role = 'CLIENTE' AND app.client_can(p_event, 'progress'))
  )
$$;

-- Gestão de campo: quem trabalha no campo (o Cliente tem a tela dele).
CREATE OR REPLACE FUNCTION app.can_use_field(p_event uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role NOT IN ('PRE_PRODUTOR', 'CLIENTE')
  )
$$;

-- Ver não é mexer: o Cliente não altera chamados nem anexa fotos.
DROP POLICY app_update ON occurrences;
CREATE POLICY app_update ON occurrences FOR UPDATE TO core_app
  USING (app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id) AND NOT app.is_client(event_id))
  WITH CHECK (app.can_write_occurrence(event_id, area_id, team_id) OR app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id));

DROP POLICY app_insert ON attachments;
CREATE POLICY app_insert ON attachments FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id()
  AND NOT app.is_client(event_id)
  AND EXISTS (SELECT 1 FROM occurrences o WHERE o.id = attachments.occurrence_id)
);

DROP POLICY app_select ON floor_plans;
CREATE POLICY app_select ON floor_plans FOR SELECT TO core_app USING (app.can_see_plans(event_id));
DROP POLICY app_select ON plan_points;
CREATE POLICY app_select ON plan_points FOR SELECT TO core_app USING (app.can_see_plans(event_id));

-- Custos liberados: o Cliente lê a planilha (não altera).
CREATE POLICY app_select_client ON cost_sheets   FOR SELECT TO core_app USING (app.client_can(event_id, 'costs'));
CREATE POLICY app_select_client ON cost_sections FOR SELECT TO core_app USING (app.client_can(event_id, 'costs'));
CREATE POLICY app_select_client ON cost_items    FOR SELECT TO core_app USING (app.client_can(event_id, 'costs'));
