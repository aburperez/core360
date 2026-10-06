-- CORE 360 — Diretor de produção em todos os eventos.
--
-- O Admin cadastra o diretor uma vez (tabela directors). O banco cria uma
-- participação de GERENTE para ele em cada evento aberto, e em cada evento
-- criado depois. A função continua sendo por evento: a RLS não muda.
-- Quando o diretor aceita um convite, todas as participações dele são ligadas
-- à mesma conta.

-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "director_id" UUID;

-- CreateTable
CREATE TABLE "directors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "job_title" TEXT,
    "user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directors_email_key" ON "directors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "directors_user_id_key" ON "directors"("user_id");

-- CreateIndex
CREATE INDEX "participants_director_id_idx" ON "participants"("director_id");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_director_id_fkey" FOREIGN KEY ("director_id") REFERENCES "directors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directors" ADD CONSTRAINT "directors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directors" ADD CONSTRAINT "directors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────── Regras ───────────────────────────

ALTER TABLE directors
  ADD CONSTRAINT directors_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT directors_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Eventos que recebem diretores: os que ainda não acabaram.
CREATE FUNCTION app.event_is_open(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM events
     WHERE id = p_event AND deleted_at IS NULL AND status NOT IN ('FINALIZADO', 'CANCELADO')
  )
$$;

-- Põe o diretor como Gerente num evento. Quem já está no evento (mesmo e-mail
-- ou mesma conta) fica como está, com a função que já tinha.
CREATE FUNCTION app.director_join(p_director uuid, p_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d directors;
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO d FROM directors WHERE id = p_director AND active;
  IF NOT FOUND OR NOT app.event_is_open(p_event) THEN
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

-- Diretor novo (ou reativado) entra em todos os eventos abertos.
CREATE FUNCTION directors_join_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM events WHERE deleted_at IS NULL AND status NOT IN ('FINALIZADO', 'CANCELADO') LOOP
    PERFORM app.director_join(NEW.id, e.id);
  END LOOP;
  RETURN NULL;
END
$$;

-- Evento novo recebe todos os diretores ativos.
CREATE FUNCTION events_add_directors() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d record;
BEGIN
  FOR d IN SELECT id FROM directors WHERE active LOOP
    PERFORM app.director_join(d.id, NEW.id);
  END LOOP;
  RETURN NULL;
END
$$;

CREATE TRIGGER events_add_directors
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_add_directors();

-- O que só o banco muda no diretor:
--  * a conta (user_id) é ligada pelo aceite do convite, nunca pela aplicação;
--  * o e-mail não muda (é o que liga a conta);
--  * o autor é quem está logado.
CREATE FUNCTION directors_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF session_user = 'core_app' THEN
      IF NEW.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'a conta do diretor é ligada pelo convite' USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.created_by := app.current_user_id();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'o e-mail do diretor não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF session_user = 'core_app' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'a conta do diretor é ligada pelo convite' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER directors_guard
  BEFORE INSERT OR UPDATE ON directors
  FOR EACH ROW EXECUTE FUNCTION directors_guard();

CREATE TRIGGER directors_join_events
  AFTER INSERT ON directors
  FOR EACH ROW EXECUTE FUNCTION directors_join_events();

-- Mudanças no diretor valem em todos os eventos dele.
CREATE FUNCTION directors_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.job_title IS DISTINCT FROM OLD.job_title THEN
    UPDATE participants SET name = NEW.name, phone = NEW.phone, job_title = NEW.job_title, updated_at = now()
     WHERE director_id = NEW.id;
  END IF;
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    UPDATE participants SET active = NEW.active, updated_at = now()
     WHERE director_id = NEW.id AND deleted_at IS NULL;
    IF NEW.active THEN
      PERFORM directors_join_events_for(NEW.id);
    END IF;
  END IF;
  IF NEW.user_id IS NOT NULL AND OLD.user_id IS NULL THEN
    UPDATE participants p SET user_id = NEW.user_id, joined_at = coalesce(p.joined_at, now()), updated_at = now()
     WHERE p.director_id = NEW.id AND p.user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM participants q WHERE q.event_id = p.event_id AND q.user_id = NEW.user_id);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION directors_join_events_for(p_director uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM events WHERE deleted_at IS NULL AND status NOT IN ('FINALIZADO', 'CANCELADO') LOOP
    PERFORM app.director_join(p_director, e.id);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION directors_join_events_for(uuid) FROM PUBLIC;

CREATE TRIGGER directors_sync
  AFTER UPDATE ON directors
  FOR EACH ROW EXECUTE FUNCTION directors_sync();

-- O aceite do convite (papel core_auth) liga uma participação à conta. Se ela é
-- de um diretor, a conta passa a valer para o diretor e para todas as outras
-- participações dele.
CREATE FUNCTION participants_link_director() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_current uuid;
BEGIN
  SELECT user_id INTO v_current FROM directors WHERE id = NEW.director_id;
  IF v_current IS NOT NULL AND v_current <> NEW.user_id THEN
    RAISE EXCEPTION 'esta participação é de outro diretor' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE directors SET user_id = NEW.user_id, updated_at = now() WHERE id = NEW.director_id AND user_id IS NULL;
  RETURN NULL;
END
$$;

CREATE TRIGGER participants_link_director
  AFTER UPDATE OF user_id ON participants
  FOR EACH ROW
  WHEN (NEW.director_id IS NOT NULL AND OLD.user_id IS NULL AND NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION participants_link_director();

-- A aplicação não cria nem muda o vínculo com diretor: quem faz isso é o banco.
CREATE FUNCTION participants_director_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'core_app'
     AND ((TG_OP = 'INSERT' AND NEW.director_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.director_id IS DISTINCT FROM OLD.director_id)) THEN
    RAISE EXCEPTION 'participação de diretor é criada pelo banco' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER participants_director_guard
  BEFORE INSERT OR UPDATE ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_director_guard();

-- ─────────────────────────── Acesso ───────────────────────────

ALTER TABLE directors ENABLE ROW LEVEL SECURITY;

-- Só o Admin vê e cadastra diretores.
CREATE POLICY app_select ON directors FOR SELECT TO core_app USING (app.is_admin());
CREATE POLICY app_insert ON directors FOR INSERT TO core_app WITH CHECK (app.is_admin());
CREATE POLICY app_update ON directors FOR UPDATE TO core_app USING (app.is_admin()) WITH CHECK (app.is_admin());

GRANT SELECT, INSERT, UPDATE ON directors TO core_app;
