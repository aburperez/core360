-- CORE 360 — Etapa 4: isolamento de dados no banco (Row Level Security).
--
-- A aplicação (papel core_app) abre uma transação por requisição e faz
--   SELECT set_config('app.user_id', '<uuid>', true)
-- Sem isso, app.current_user_id() é NULL e todas as políticas devolvem zero
-- linhas (falha fechada). O dono das tabelas (core_owner) não é afetado: ele só
-- roda migrations e seed.
--
-- O banco garante o PERÍMETRO (ninguém lê ou grava fora do seu evento, área ou
-- equipe, nem atribui papel acima do permitido). Regras finas de ação (quem
-- valida, quem conclui) ficam também no backend, em src/modules/*/policy.ts.
--
-- Pré-requisito: papéis core_app e core_auth existem (docker/init-roles.sql).

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO core_app, core_auth;

-- ───────────────────────── Funções de contexto ─────────────────────────

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
     WHERE id = app.current_user_id() AND is_admin AND active
  )
$$;

-- Participação ativa do usuário atual no evento (no máximo uma linha).
CREATE FUNCTION app.membership(p_event uuid)
RETURNS TABLE (participant_id uuid, role participant_role, area_id uuid, team_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.role, p.area_id, p.team_id
    FROM participants p
    JOIN users u  ON u.id = p.user_id
    JOIN events e ON e.id = p.event_id
   WHERE p.user_id = app.current_user_id()
     AND p.event_id = p_event
     AND p.active AND p.deleted_at IS NULL
     AND u.active
     AND e.deleted_at IS NULL
$$;

CREATE FUNCTION app.event_role(p_event uuid) RETURNS participant_role
LANGUAGE sql STABLE AS $$
  SELECT role FROM app.membership(p_event)
$$;

CREATE FUNCTION app.can_see_event(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (SELECT 1 FROM app.membership(p_event))
$$;

-- Gerente, Cliente e Head enxergam a lista de áreas do evento (o Head precisa
-- dos nomes para encaminhar chamados). Operacional só a própria área.
CREATE FUNCTION app.can_see_area(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE', 'HEAD')
        OR (m.role = 'OPERACIONAL' AND m.area_id = p_area)
  )
$$;

CREATE FUNCTION app.can_manage_area(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role IN ('GERENTE', 'CLIENTE')
  )
$$;

CREATE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$$;

CREATE FUNCTION app.can_manage_team(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
  )
$$;

CREATE FUNCTION app.can_see_participant(p_event uuid, p_area uuid, p_team uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_admin()
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'CLIENTE')
            OR (m.role = 'HEAD' AND m.area_id = p_area)
            OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
      )
$$;

-- Quem pode atribuir qual papel (anti-escalada de privilégio):
--   ADMIN   → qualquer papel
--   GERENTE → HEAD, OPERACIONAL, CLIENTE
--   CLIENTE → CLIENTE, OPERACIONAL
--   HEAD    → OPERACIONAL na própria área
CREATE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE'))
        OR (m.role = 'CLIENTE' AND p_role IN ('CLIENTE', 'OPERACIONAL'))
        OR (m.role = 'HEAD'    AND p_role = 'OPERACIONAL' AND p_area = m.area_id)
  )
$$;

-- Cliente não enxerga ocorrências (decisão padrão do MVP).
CREATE FUNCTION app.can_see_occurrence(p_event uuid, p_area uuid, p_team uuid, p_responsible uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND (m.team_id = p_team OR m.participant_id = p_responsible))
  )
$$;

CREATE FUNCTION app.can_write_occurrence(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO core_app, core_auth;

-- ───────────────────────── Permissões por papel ─────────────────────────

-- core_app nunca toca nas tabelas de sessão: isso é do login (core_auth).
REVOKE ALL ON sessions, accounts, verifications FROM core_app;

-- Vínculo participante↔usuário e criador não são editáveis pela aplicação.
REVOKE UPDATE ON participants FROM core_app;
GRANT UPDATE (name, email, phone, job_title, role, area_id, team_id, active, invited_at, deleted_at, updated_at)
  ON participants TO core_app;

GRANT SELECT, INSERT ON invitations TO core_app;

-- core_auth: só identidade. Lê usuários e participações para login e convites.
GRANT USAGE ON SCHEMA public TO core_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications TO core_auth;
GRANT SELECT, INSERT, UPDATE ON users TO core_auth;
GRANT SELECT ON participants, invitations TO core_auth;
GRANT UPDATE (user_id, joined_at, updated_at) ON participants TO core_auth;
GRANT UPDATE (used_at) ON invitations TO core_auth;
GRANT INSERT ON audit_log TO core_auth;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO core_auth;

-- ───────────────────────── Ativar RLS ─────────────────────────

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE occurrences    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;

-- ───────────────────────── Políticas: core_auth ─────────────────────────

CREATE POLICY auth_all       ON users        TO core_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_read      ON participants TO core_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_read      ON invitations  TO core_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_insert    ON audit_log    FOR INSERT TO core_auth WITH CHECK (true);

-- ───────────────────────── Políticas: core_app ─────────────────────────

-- users: a si mesmo, quem aparece nas participações visíveis, e admin.
CREATE POLICY app_select ON users FOR SELECT TO core_app USING (
  id = app.current_user_id()
  OR app.is_admin()
  OR EXISTS (SELECT 1 FROM participants p WHERE p.user_id = users.id)
);
CREATE POLICY app_insert ON users FOR INSERT TO core_app WITH CHECK (app.is_admin());
CREATE POLICY app_update ON users FOR UPDATE TO core_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- clients
CREATE POLICY app_select ON clients FOR SELECT TO core_app USING (
  app.is_admin() OR EXISTS (SELECT 1 FROM events e WHERE e.client_id = clients.id)
);
CREATE POLICY app_insert ON clients FOR INSERT TO core_app WITH CHECK (app.is_admin());
CREATE POLICY app_update ON clients FOR UPDATE TO core_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- events
CREATE POLICY app_select ON events FOR SELECT TO core_app USING (app.can_see_event(id));
CREATE POLICY app_insert ON events FOR INSERT TO core_app WITH CHECK (app.is_admin());
CREATE POLICY app_update ON events FOR UPDATE TO core_app
  USING (app.is_admin() OR app.event_role(id) = 'GERENTE')
  WITH CHECK (app.is_admin() OR app.event_role(id) = 'GERENTE');

-- areas
CREATE POLICY app_select ON areas FOR SELECT TO core_app USING (app.can_see_area(event_id, id));
CREATE POLICY app_insert ON areas FOR INSERT TO core_app WITH CHECK (app.can_manage_area(event_id));
CREATE POLICY app_update ON areas FOR UPDATE TO core_app
  USING (app.can_manage_area(event_id)) WITH CHECK (app.can_manage_area(event_id));

-- teams
CREATE POLICY app_select ON teams FOR SELECT TO core_app USING (app.can_see_team(event_id, area_id, id));
CREATE POLICY app_insert ON teams FOR INSERT TO core_app WITH CHECK (app.can_manage_team(event_id, area_id));
CREATE POLICY app_update ON teams FOR UPDATE TO core_app
  USING (app.can_manage_team(event_id, area_id)) WITH CHECK (app.can_manage_team(event_id, area_id));

-- participants: ninguém cria ou altera a própria participação (exceto admin),
-- e só atribui papéis permitidos pela matriz.
CREATE POLICY app_select ON participants FOR SELECT TO core_app
  USING (app.can_see_participant(event_id, area_id, team_id, user_id));
CREATE POLICY app_insert ON participants FOR INSERT TO core_app WITH CHECK (
  app.can_assign_role(event_id, role, area_id)
  AND (user_id IS NULL OR app.is_admin())
);
CREATE POLICY app_update ON participants FOR UPDATE TO core_app
  USING (
    app.can_assign_role(event_id, role, area_id)
    AND (user_id IS DISTINCT FROM app.current_user_id() OR app.is_admin())
  )
  WITH CHECK (
    app.can_assign_role(event_id, role, area_id)
    AND (user_id IS DISTINCT FROM app.current_user_id() OR app.is_admin())
  );

-- invitations: só para participantes que o usuário pode gerenciar.
CREATE POLICY app_select ON invitations FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM participants p
           WHERE p.id = invitations.participant_id
             AND app.can_assign_role(p.event_id, p.role, p.area_id))
);
CREATE POLICY app_insert ON invitations FOR INSERT TO core_app WITH CHECK (
  created_by = app.current_user_id()
  AND EXISTS (SELECT 1 FROM participants p
               WHERE p.id = invitations.participant_id
                 AND p.event_id = invitations.event_id
                 AND app.can_assign_role(p.event_id, p.role, p.area_id))
);

-- occurrences
CREATE POLICY app_select ON occurrences FOR SELECT TO core_app
  USING (app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id));
CREATE POLICY app_insert ON occurrences FOR INSERT TO core_app WITH CHECK (
  created_by = app.current_user_id()
  AND app.can_write_occurrence(event_id, area_id, team_id)
);
CREATE POLICY app_update ON occurrences FOR UPDATE TO core_app
  USING (app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id))
  WITH CHECK (app.can_write_occurrence(event_id, area_id, team_id)
              OR app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id));

-- attachments: seguem a visibilidade da ocorrência (a subconsulta passa pela RLS).
CREATE POLICY app_select ON attachments FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM occurrences o WHERE o.id = attachments.occurrence_id)
);
CREATE POLICY app_insert ON attachments FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id()
  AND EXISTS (SELECT 1 FROM occurrences o WHERE o.id = attachments.occurrence_id)
);
CREATE POLICY app_update ON attachments FOR UPDATE TO core_app
  USING (uploaded_by = app.current_user_id() OR app.is_admin())
  WITH CHECK (uploaded_by = app.current_user_id() OR app.is_admin());

-- sla_policies
CREATE POLICY app_select ON sla_policies FOR SELECT TO core_app USING (app.can_see_event(event_id));
CREATE POLICY app_insert ON sla_policies FOR INSERT TO core_app
  WITH CHECK (app.is_admin() OR app.event_role(event_id) = 'GERENTE');
CREATE POLICY app_update ON sla_policies FOR UPDATE TO core_app
  USING (app.is_admin() OR app.event_role(event_id) = 'GERENTE')
  WITH CHECK (app.is_admin() OR app.event_role(event_id) = 'GERENTE');

-- notifications: cada um lê e marca como lidas só as suas.
CREATE POLICY app_select ON notifications FOR SELECT TO core_app USING (user_id = app.current_user_id());
CREATE POLICY app_insert ON notifications FOR INSERT TO core_app
  WITH CHECK (event_id IS NOT NULL AND app.can_see_event(event_id));
CREATE POLICY app_update ON notifications FOR UPDATE TO core_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

-- audit_log: grava só em nome próprio; lê admin, gerente do evento ou o autor.
CREATE POLICY app_select ON audit_log FOR SELECT TO core_app USING (
  app.is_admin()
  OR actor_user_id = app.current_user_id()
  OR (event_id IS NOT NULL AND app.event_role(event_id) = 'GERENTE')
);
CREATE POLICY app_insert ON audit_log FOR INSERT TO core_app
  WITH CHECK (actor_user_id = app.current_user_id());

-- ───────────────────────── Desativação derruba sessões ─────────────────────────

CREATE FUNCTION users_revoke_sessions_on_deactivate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM sessions WHERE user_id = NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION users_revoke_sessions_on_deactivate() FROM PUBLIC;

CREATE TRIGGER users_revoke_sessions_on_deactivate
  AFTER UPDATE OF active ON users
  FOR EACH ROW WHEN (OLD.active AND NOT NEW.active)
  EXECUTE FUNCTION users_revoke_sessions_on_deactivate();
