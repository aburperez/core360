-- Pré-produção separada do campo (pedido do Abu, 2026-10-06): só o
-- Pré-produtor e o gestor (Gerente do evento, ou Admin) usam a Pré-produção.
-- Head, Operacional e Cliente ficam de fora. O Pré-produtor propõe o SLA; só
-- o Gerente aprova, ajusta, recusa ou define direto.
-- Espelha src/server/authz/policy.ts (canUsePreProduction, canReviewSla).

-- ─────────────── Pré-produtor enxerga a estrutura do evento ───────────────
-- Precisa das áreas, equipes e pessoas para planejar (como o Cliente), mas
-- não vê chamados e não altera a estrutura.

CREATE OR REPLACE FUNCTION app.can_see_area(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE', 'HEAD', 'PRE_PRODUTOR')
        OR (m.role = 'OPERACIONAL' AND m.area_id = p_area)
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE', 'PRE_PRODUTOR')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_participant(
  p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_admin()
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'CLIENTE', 'PRE_PRODUTOR')
            OR (m.role = 'HEAD' AND (m.area_id = p_area OR p_role = 'GERENTE'))
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$$;

-- Só o Gerente (e o Admin) coloca alguém como Pré-produtor.
CREATE OR REPLACE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE', 'PRE_PRODUTOR'))
        OR (m.role = 'CLIENTE' AND p_role IN ('CLIENTE', 'OPERACIONAL'))
        OR (m.role = 'HEAD'    AND p_role = 'OPERACIONAL' AND p_area = m.area_id)
  )
$$;

-- Pré-produtor é do evento, não de uma área ou equipe.
ALTER TABLE participants
  ADD CONSTRAINT participants_pre_produtor_event_level
  CHECK (role <> 'PRE_PRODUTOR' OR (area_id IS NULL AND team_id IS NULL));

-- ─────────────────────── Acesso à Pré-produção ───────────────────────

CREATE FUNCTION app.can_use_pre_production(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR')
  )
$$;

CREATE FUNCTION app.can_review_sla(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

REVOKE ALL ON FUNCTION app.can_use_pre_production(uuid), app.can_review_sla(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_use_pre_production(uuid), app.can_review_sla(uuid) TO core_app;

DROP POLICY app_insert ON service_types;
DROP POLICY app_update ON service_types;
DROP POLICY app_select ON sla_proposals;
DROP POLICY app_insert ON sla_proposals;
DROP POLICY app_update ON sla_proposals;
DROP POLICY app_select ON service_type_people;
DROP POLICY app_insert ON service_type_people;
DROP POLICY app_delete ON service_type_people;
DROP FUNCTION app.can_propose_sla(uuid, uuid, uuid);
DROP FUNCTION app.can_manage_service_type(uuid, uuid);

-- Tipos: a Pré-produção cria e edita. A leitura continua seguindo a equipe
-- (app_select de antes): quem abre um chamado escolhe o tipo e vê o prazo,
-- sem acesso à Pré-produção.
CREATE POLICY app_insert ON service_types FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON service_types FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));

-- O prazo do tipo só muda pelas mãos do Gerente (aprovando ou definindo).
-- Sem usuário na sessão (migrations e seed do dono) a regra não se aplica;
-- o app sempre roda com usuário, e sem ele a RLS já bloqueia tudo.
CREATE FUNCTION service_types_guard_sla() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NOT NULL
     AND (TG_OP = 'INSERT' AND NEW.sla_minutes IS NOT NULL
          OR TG_OP = 'UPDATE' AND NEW.sla_minutes IS DISTINCT FROM OLD.sla_minutes)
     AND NOT app.can_review_sla(NEW.event_id) THEN
    RAISE EXCEPTION 'só o gerente define o SLA' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER service_types_guard_sla
  BEFORE INSERT OR UPDATE ON service_types
  FOR EACH ROW EXECUTE FUNCTION service_types_guard_sla();

-- Propostas e quem faz o quê: só a Pré-produção vê e grava.
CREATE POLICY app_select ON sla_proposals FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON sla_proposals FOR INSERT TO core_app WITH CHECK (
  proposed_by = app.current_user_id()
  AND app.can_use_pre_production(event_id)
  AND (
    (status = 'PENDENTE' AND reviewed_by IS NULL)
    OR (app.can_review_sla(event_id) AND reviewed_by = app.current_user_id())
  )
);
CREATE POLICY app_update ON sla_proposals FOR UPDATE TO core_app
  USING (app.can_review_sla(event_id))
  WITH CHECK (app.can_review_sla(event_id) AND reviewed_by = app.current_user_id());

CREATE POLICY app_select ON service_type_people FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON service_type_people FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON service_type_people FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));
