-- CORE 360 — Várias agências no mesmo app.
--
-- Cada agência que aluga o CORE 360 é um espaço fechado. Clientes, eventos e
-- diretores passam a ter agency_id, e o "Admin" deixa de ser global: é o Admin
-- da agência (agency_admins) e só vale para os eventos dela. users.is_admin
-- passa a ser o Admin da plataforma, que cria e suspende agências mas não
-- enxerga os eventos delas por isso.
--
-- Os dados que já existem vão para a "Agência principal", e quem era Admin
-- vira Admin dela: nada some para ninguém.

-- CreateEnum
CREATE TYPE "agency_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- DropForeignKey
ALTER TABLE "events" DROP CONSTRAINT "events_client_id_fkey";

-- DropIndex
DROP INDEX "directors_email_key";

-- DropIndex
DROP INDEX "directors_user_id_key";

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "agency_id" UUID;

-- AlterTable
ALTER TABLE "directors" ADD COLUMN     "agency_id" UUID;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "agency_id" UUID;

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "agency_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_admins" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agency_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_invitations" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "agency_admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_admins_user_id_idx" ON "agency_admins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_admins_agency_id_email_key" ON "agency_admins"("agency_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "agency_admins_agency_id_id_key" ON "agency_admins"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agency_invitations_token_hash_key" ON "agency_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "agency_invitations_agency_admin_id_idx" ON "agency_invitations"("agency_admin_id");

-- CreateIndex
CREATE INDEX "clients_agency_id_idx" ON "clients"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_agency_id_id_key" ON "clients"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "directors_agency_id_email_key" ON "directors"("agency_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "directors_agency_id_user_id_key" ON "directors"("agency_id", "user_id");

-- CreateIndex
CREATE INDEX "events_agency_id_idx" ON "events"("agency_id");

-- AddForeignKey
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_agency_id_agency_admin_id_fkey" FOREIGN KEY ("agency_id", "agency_admin_id") REFERENCES "agency_admins"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_agency_id_client_id_fkey" FOREIGN KEY ("agency_id", "client_id") REFERENCES "clients"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directors" ADD CONSTRAINT "directors_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Dados que já existem ───────────────────────────

DO $$
DECLARE
  v uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM clients) OR EXISTS (SELECT 1 FROM directors) OR EXISTS (SELECT 1 FROM users WHERE is_admin) THEN
    v := gen_random_uuid();
    INSERT INTO agencies (id, name, updated_at) VALUES (v, 'Agência principal', now());
    UPDATE clients   SET agency_id = v;
    UPDATE events    SET agency_id = v;
    UPDATE directors SET agency_id = v;
    INSERT INTO agency_admins (id, agency_id, name, email, user_id, updated_at)
      SELECT gen_random_uuid(), v, name, email, id, now() FROM users WHERE is_admin;
  END IF;
END
$$;

ALTER TABLE clients   ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE events    ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE directors ALTER COLUMN agency_id SET NOT NULL;

-- ─────────────────────────── Regras ───────────────────────────

ALTER TABLE agencies
  ADD CONSTRAINT agencies_name_not_blank CHECK (btrim(name) <> '');
ALTER TABLE agency_admins
  ADD CONSTRAINT agency_admins_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT agency_admins_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Nada muda de agência depois de criado.
CREATE FUNCTION agency_id_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.agency_id IS DISTINCT FROM OLD.agency_id THEN
    RAISE EXCEPTION 'não dá para mudar a agência de um registro' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clients_agency_frozen       BEFORE UPDATE OF agency_id ON clients       FOR EACH ROW EXECUTE FUNCTION agency_id_frozen();
CREATE TRIGGER events_agency_frozen        BEFORE UPDATE OF agency_id ON events        FOR EACH ROW EXECUTE FUNCTION agency_id_frozen();
CREATE TRIGGER directors_agency_frozen     BEFORE UPDATE OF agency_id ON directors     FOR EACH ROW EXECUTE FUNCTION agency_id_frozen();
CREATE TRIGGER agency_admins_agency_frozen BEFORE UPDATE OF agency_id ON agency_admins FOR EACH ROW EXECUTE FUNCTION agency_id_frozen();

-- O que só o banco muda no Admin da agência: a conta (pelo aceite do convite),
-- o e-mail (é o que liga a conta) e o autor. E ninguém se desativa sozinho.
CREATE FUNCTION agency_admins_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF session_user = 'core_app' THEN
      IF NEW.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'a conta do Admin é ligada pelo convite' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.created_by := app.current_user_id();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'o e-mail do Admin não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF session_user = 'core_app' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'a conta do Admin é ligada pelo convite' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.user_id = app.current_user_id() AND NEW.active IS DISTINCT FROM OLD.active THEN
      RAISE EXCEPTION 'ninguém desativa o próprio acesso de Admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER agency_admins_guard
  BEFORE INSERT OR UPDATE ON agency_admins
  FOR EACH ROW EXECUTE FUNCTION agency_admins_guard();

-- O autor da agência é quem está logado, e não muda.
CREATE FUNCTION agencies_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user = 'core_app' AND TG_OP = 'INSERT' THEN
    NEW.created_by := app.current_user_id();
  END IF;
  IF session_user = 'core_app' AND TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'o autor da agência não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER agencies_guard
  BEFORE INSERT OR UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION agencies_guard();

-- ─────────────────────────── Quem é Admin de quê ───────────────────────────

-- Admin da plataforma (antes "Admin"): cria e suspende agências.
CREATE FUNCTION app.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
     WHERE id = app.current_user_id() AND is_admin AND active
  )
$$;

-- Agências em que o usuário atual é Admin. Agência suspensa não conta.
CREATE FUNCTION app.admin_agencies() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.agency_id
    FROM agency_admins a
    JOIN agencies g ON g.id = a.agency_id
    JOIN users u    ON u.id = a.user_id
   WHERE a.user_id = app.current_user_id()
     AND a.active AND u.active
     AND g.status = 'ACTIVE'
$$;

CREATE FUNCTION app.is_agency_admin(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_agency IN (SELECT app.admin_agencies())
$$;

-- Admin da agência dona do evento: no evento, vale o que valia o Admin global.
CREATE FUNCTION app.is_event_admin(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event AND e.agency_id IN (SELECT app.admin_agencies())
  )
$$;

-- Agência suspensa: ninguém dos eventos dela entra até ser reativada.
CREATE OR REPLACE FUNCTION app.membership(p_event uuid)
RETURNS TABLE (participant_id uuid, role participant_role, area_id uuid, team_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.role, p.area_id, p.team_id
    FROM participants p
    JOIN users u    ON u.id = p.user_id
    JOIN events e   ON e.id = p.event_id
    JOIN agencies g ON g.id = e.agency_id
   WHERE p.user_id = app.current_user_id()
     AND p.event_id = p_event
     AND p.active AND p.deleted_at IS NULL
     AND u.active
     AND e.deleted_at IS NULL
     AND g.status = 'ACTIVE'
$$;

-- As regras por evento trocam o Admin global pelo Admin da agência do evento.
CREATE OR REPLACE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE', 'PRE_PRODUTOR'))
        OR (m.role = 'CLIENTE' AND p_role IN ('CLIENTE', 'OPERACIONAL'))
        OR (m.role = 'HEAD'    AND p_role = 'OPERACIONAL' AND p_area = m.area_id)
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_manage_area(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role IN ('GERENTE', 'CLIENTE')
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_manage_team(p_event uuid, p_area uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_review_sla(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_see_area(p_event uuid, p_area uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE', 'HEAD', 'PRE_PRODUTOR')
        OR (m.role = 'OPERACIONAL' AND m.area_id = p_area)
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_see_event(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (SELECT 1 FROM app.membership(p_event))
$function$
;

CREATE OR REPLACE FUNCTION app.can_see_occurrence(p_event uuid, p_area uuid, p_team uuid, p_responsible uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND (m.team_id = p_team OR m.participant_id = p_responsible))
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_see_participant(p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_event_admin(p_event)
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'CLIENTE', 'PRE_PRODUTOR')
            OR (m.role = 'HEAD' AND (m.area_id = p_area OR p_role = 'GERENTE'))
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$function$
;

CREATE OR REPLACE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'CLIENTE', 'PRE_PRODUTOR')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_send_to_field(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_use_pre_production(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR')
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_write_occurrence(p_event uuid, p_area uuid, p_team uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
  )
$function$
;

CREATE OR REPLACE FUNCTION app.can_write_report(p_event uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$function$
;


-- ─────────────────────────── Diretores por agência ───────────────────────────

-- O diretor só entra nos eventos da própria agência.
CREATE OR REPLACE FUNCTION app.director_join(p_director uuid, p_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d directors;
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO d FROM directors WHERE id = p_director AND active;
  IF NOT FOUND OR NOT app.event_is_open(p_event)
     OR NOT EXISTS (SELECT 1 FROM events WHERE id = p_event AND agency_id = d.agency_id) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM participants
     WHERE event_id = p_event AND (email = d.email OR (d.user_id IS NOT NULL AND user_id = d.user_id))
  ) THEN
    RETURN;
  END IF;
  INSERT INTO participants
    (id, event_id, user_id, name, email, phone, job_title, role, active, director_id, created_by, joined_at, created_at, updated_at)
  VALUES
    (v_id, p_event, d.user_id, d.name, d.email, d.phone, d.job_title, 'GERENTE', true, d.id, app.current_user_id(),
     CASE WHEN d.user_id IS NOT NULL THEN now() END, now(), now());
  INSERT INTO audit_log (actor_user_id, event_id, entity, entity_id, action, after)
  VALUES (app.current_user_id(), p_event, 'participant', v_id, 'CREATE',
          jsonb_build_object('role', 'GERENTE', 'directorId', d.id));
END
$$;
REVOKE ALL ON FUNCTION app.director_join(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION directors_join_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM directors_join_events_for(NEW.id);
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION directors_join_events_for(p_director uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT ev.id FROM events ev JOIN directors d ON d.agency_id = ev.agency_id
            WHERE d.id = p_director AND ev.deleted_at IS NULL AND ev.status NOT IN ('FINALIZADO', 'CANCELADO') LOOP
    PERFORM app.director_join(p_director, e.id);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION directors_join_events_for(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION events_add_directors() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d record;
BEGIN
  FOR d IN SELECT id FROM directors WHERE active AND agency_id = NEW.agency_id LOOP
    PERFORM app.director_join(d.id, NEW.id);
  END LOOP;
  RETURN NULL;
END
$$;

-- ─────────────────────────── Acesso ───────────────────────────

ALTER TABLE agencies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_admins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_invitations ENABLE ROW LEVEL SECURITY;

-- agencies: a plataforma vê todas; o Admin vê a(s) dele, mesmo suspensa
-- (para o app mostrar o aviso). Só a plataforma cria, renomeia e suspende.
CREATE POLICY app_select ON agencies FOR SELECT TO core_app USING (
  app.is_platform_admin()
  OR EXISTS (SELECT 1 FROM agency_admins a WHERE a.agency_id = agencies.id AND a.user_id = app.current_user_id() AND a.active)
);
CREATE POLICY app_insert ON agencies FOR INSERT TO core_app WITH CHECK (app.is_platform_admin());
CREATE POLICY app_update ON agencies FOR UPDATE TO core_app
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- agency_admins: a plataforma e os Admins da própria agência. A pessoa vê a
-- própria linha. A plataforma e o Admin da agência cadastram outros Admins.
CREATE POLICY app_select ON agency_admins FOR SELECT TO core_app USING (
  app.is_platform_admin() OR app.is_agency_admin(agency_id) OR user_id = app.current_user_id()
);
CREATE POLICY app_insert ON agency_admins FOR INSERT TO core_app
  WITH CHECK (app.is_platform_admin() OR app.is_agency_admin(agency_id));
CREATE POLICY app_update ON agency_admins FOR UPDATE TO core_app
  USING (app.is_platform_admin() OR app.is_agency_admin(agency_id))
  WITH CHECK (app.is_platform_admin() OR app.is_agency_admin(agency_id));

CREATE POLICY app_select ON agency_invitations FOR SELECT TO core_app
  USING (app.is_platform_admin() OR app.is_agency_admin(agency_id));
CREATE POLICY app_insert ON agency_invitations FOR INSERT TO core_app WITH CHECK (
  created_by = app.current_user_id()
  AND (app.is_platform_admin() OR app.is_agency_admin(agency_id))
);

GRANT SELECT, INSERT, UPDATE ON agencies, agency_admins TO core_app;
GRANT SELECT, INSERT ON agency_invitations TO core_app;
REVOKE UPDATE ON agency_admins FROM core_app;
GRANT UPDATE (name, active, updated_at) ON agency_admins TO core_app;

-- Aceite do convite de Admin (papel core_auth): lê o convite e liga a conta.
GRANT SELECT ON agencies, agency_admins, agency_invitations TO core_auth;
GRANT UPDATE (user_id, updated_at) ON agency_admins TO core_auth;
GRANT UPDATE (used_at) ON agency_invitations TO core_auth;
CREATE POLICY auth_all ON agencies           TO core_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON agency_admins      TO core_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON agency_invitations TO core_auth USING (true) WITH CHECK (true);

-- users: além de quem aparece nas participações, os Admins e diretores
-- visíveis (as subconsultas passam pela RLS dessas tabelas).
DROP POLICY app_select ON users;
CREATE POLICY app_select ON users FOR SELECT TO core_app USING (
  id = app.current_user_id()
  OR EXISTS (SELECT 1 FROM participants p WHERE p.user_id = users.id)
  OR EXISTS (SELECT 1 FROM agency_admins a WHERE a.user_id = users.id)
  OR EXISTS (SELECT 1 FROM directors d WHERE d.user_id = users.id)
);
DROP POLICY app_insert ON users;
CREATE POLICY app_insert ON users FOR INSERT TO core_app WITH CHECK (app.is_platform_admin());
DROP POLICY app_update ON users;
CREATE POLICY app_update ON users FOR UPDATE TO core_app
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- clients: o Admin da agência; os outros veem o cliente dos eventos deles.
DROP POLICY app_select ON clients;
CREATE POLICY app_select ON clients FOR SELECT TO core_app USING (
  app.is_agency_admin(agency_id) OR EXISTS (SELECT 1 FROM events e WHERE e.client_id = clients.id)
);
DROP POLICY app_insert ON clients;
CREATE POLICY app_insert ON clients FOR INSERT TO core_app WITH CHECK (app.is_agency_admin(agency_id));
DROP POLICY app_update ON clients;
CREATE POLICY app_update ON clients FOR UPDATE TO core_app
  USING (app.is_agency_admin(agency_id)) WITH CHECK (app.is_agency_admin(agency_id));

-- events (o INSERT ... RETURNING precisa enxergar a linha nova pela própria agência)
DROP POLICY app_select ON events;
CREATE POLICY app_select ON events FOR SELECT TO core_app
  USING (app.can_see_event(id) OR app.is_agency_admin(agency_id));
DROP POLICY app_insert ON events;
CREATE POLICY app_insert ON events FOR INSERT TO core_app WITH CHECK (app.is_agency_admin(agency_id));
DROP POLICY app_update ON events;
CREATE POLICY app_update ON events FOR UPDATE TO core_app
  USING (app.is_event_admin(id) OR app.event_role(id) = 'GERENTE')
  WITH CHECK (app.is_event_admin(id) OR app.event_role(id) = 'GERENTE');

-- directors
DROP POLICY app_select ON directors;
CREATE POLICY app_select ON directors FOR SELECT TO core_app USING (app.is_agency_admin(agency_id));
DROP POLICY app_insert ON directors;
CREATE POLICY app_insert ON directors FOR INSERT TO core_app WITH CHECK (app.is_agency_admin(agency_id));
DROP POLICY app_update ON directors;
CREATE POLICY app_update ON directors FOR UPDATE TO core_app
  USING (app.is_agency_admin(agency_id)) WITH CHECK (app.is_agency_admin(agency_id));

-- participants
DROP POLICY app_insert ON participants;
CREATE POLICY app_insert ON participants FOR INSERT TO core_app WITH CHECK (
  app.can_assign_role(event_id, role, area_id)
  AND (user_id IS NULL OR app.is_event_admin(event_id))
);
DROP POLICY app_update ON participants;
CREATE POLICY app_update ON participants FOR UPDATE TO core_app
  USING (
    app.can_assign_role(event_id, role, area_id)
    AND (user_id IS DISTINCT FROM app.current_user_id() OR app.is_event_admin(event_id))
  )
  WITH CHECK (
    app.can_assign_role(event_id, role, area_id)
    AND (user_id IS DISTINCT FROM app.current_user_id() OR app.is_event_admin(event_id))
  );

-- attachments
DROP POLICY app_update ON attachments;
CREATE POLICY app_update ON attachments FOR UPDATE TO core_app
  USING (uploaded_by = app.current_user_id() OR app.is_event_admin(event_id))
  WITH CHECK (uploaded_by = app.current_user_id() OR app.is_event_admin(event_id));

-- sla_policies
DROP POLICY app_insert ON sla_policies;
CREATE POLICY app_insert ON sla_policies FOR INSERT TO core_app
  WITH CHECK (app.is_event_admin(event_id) OR app.event_role(event_id) = 'GERENTE');
DROP POLICY app_update ON sla_policies;
CREATE POLICY app_update ON sla_policies FOR UPDATE TO core_app
  USING (app.is_event_admin(event_id) OR app.event_role(event_id) = 'GERENTE')
  WITH CHECK (app.is_event_admin(event_id) OR app.event_role(event_id) = 'GERENTE');

-- audit_log: o Admin lê o que é dos eventos da agência dele.
DROP POLICY app_select ON audit_log;
CREATE POLICY app_select ON audit_log FOR SELECT TO core_app USING (
  actor_user_id = app.current_user_id()
  OR (event_id IS NOT NULL AND (app.is_event_admin(event_id) OR app.event_role(event_id) = 'GERENTE'))
);

-- O Admin global deixa de existir. Se algo ainda dependesse dele, este DROP falharia.
DROP FUNCTION app.is_admin();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO core_app, core_auth;
