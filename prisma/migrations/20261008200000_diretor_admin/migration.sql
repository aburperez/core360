-- Diretor de produção = painel administrativo da agência (Abu, 2026-10-08).
-- Antes havia dois papéis: o Admin da agência (abre clientes e eventos) e o
-- Diretor (Gerente em todos os eventos, sem abrir evento). Agora são a mesma
-- pessoa: cada diretor tem um Admin ligado (agency_admins.director_id) e o
-- banco mantém os dois iguais (nome, ativo, conta). Cadastrar um cria o outro.
-- O Suporte CORE 360 continua só em agency_admins, sem diretor.

-- AlterTable
ALTER TABLE "agency_admins" ADD COLUMN     "director_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "agency_admins_director_id_key" ON "agency_admins"("director_id");

-- AddForeignKey
ALTER TABLE "agency_admins" ADD CONSTRAINT "agency_admins_director_id_fkey" FOREIGN KEY ("director_id") REFERENCES "directors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────────────────── Dados que já existem ─────────────────────────

-- Admins sem diretor viram diretores (o gatilho que já existe os põe como
-- Gerente nos eventos abertos da agência).
INSERT INTO directors (id, agency_id, name, email, user_id, active, created_by, created_at, updated_at)
SELECT gen_random_uuid(), a.agency_id, a.name, a.email, a.user_id, a.active,
       coalesce(a.created_by, a.user_id, (SELECT u.id FROM users u ORDER BY u.is_admin DESC, u.created_at LIMIT 1)),
       now(), now()
  FROM agency_admins a
 WHERE a.role = 'ADMIN'
   AND NOT EXISTS (SELECT 1 FROM directors d WHERE d.agency_id = a.agency_id AND d.email = a.email)
   AND (a.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM directors d WHERE d.agency_id = a.agency_id AND d.user_id = a.user_id));

-- Liga cada Admin ao diretor do mesmo e-mail.
UPDATE agency_admins a SET director_id = d.id
  FROM directors d
 WHERE a.role = 'ADMIN' AND a.director_id IS NULL AND d.agency_id = a.agency_id AND d.email = a.email;

-- Diretores sem Admin ganham o acesso de Admin (com a conta, se já tiverem).
INSERT INTO agency_admins (id, agency_id, name, email, role, user_id, active, director_id, created_by, created_at, updated_at)
SELECT gen_random_uuid(), d.agency_id, d.name, d.email, 'ADMIN', d.user_id, d.active, d.id, d.created_by, now(), now()
  FROM directors d
 WHERE NOT EXISTS (SELECT 1 FROM agency_admins a WHERE a.director_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM agency_admins a WHERE a.agency_id = d.agency_id AND a.email = d.email);

-- Conta: quem já entrou por um dos lados vale para o outro.
UPDATE agency_admins a SET user_id = d.user_id
  FROM directors d WHERE a.director_id = d.id AND a.user_id IS NULL AND d.user_id IS NOT NULL;
UPDATE directors d SET user_id = a.user_id
  FROM agency_admins a WHERE a.director_id = d.id AND d.user_id IS NULL AND a.user_id IS NOT NULL;

-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE agency_admins
  ADD CONSTRAINT agency_admins_director_role CHECK (director_id IS NULL OR role = 'ADMIN');

-- O vínculo com o diretor é do banco: a aplicação não cria nem muda.
CREATE FUNCTION agency_admins_director_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF session_user IN ('core_app', 'core_auth')
     AND ((TG_OP = 'INSERT' AND NEW.director_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.director_id IS DISTINCT FROM OLD.director_id))
     AND current_user <> 'core_owner' THEN
    RAISE EXCEPTION 'o vínculo do Admin com o diretor é do banco' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agency_admins_director_guard
  BEFORE INSERT OR UPDATE ON agency_admins
  FOR EACH ROW EXECUTE FUNCTION agency_admins_director_guard();

-- Novo diretor: liga ao Admin do mesmo e-mail ou cria o Admin.
CREATE FUNCTION directors_add_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE agency_admins SET director_id = NEW.id, updated_at = now()
   WHERE agency_id = NEW.agency_id AND email = NEW.email AND role = 'ADMIN' AND director_id IS NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM agency_admins WHERE agency_id = NEW.agency_id AND email = NEW.email) THEN
      RAISE EXCEPTION 'esta pessoa já está na agência como Suporte' USING ERRCODE = 'unique_violation';
    END IF;
    INSERT INTO agency_admins (id, agency_id, name, email, role, user_id, active, director_id, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.agency_id, NEW.name, NEW.email, 'ADMIN', NEW.user_id, NEW.active, NEW.id, NEW.created_by, now(), now());
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION directors_add_admin() FROM PUBLIC;
CREATE TRIGGER directors_add_admin
  AFTER INSERT ON directors
  FOR EACH ROW EXECUTE FUNCTION directors_add_admin();

-- Novo Admin (plataforma criando a agência, ou outro Admin): vira diretor.
CREATE FUNCTION agency_admins_add_director() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_director uuid;
BEGIN
  SELECT id INTO v_director FROM directors WHERE agency_id = NEW.agency_id AND email = NEW.email;
  IF v_director IS NOT NULL THEN
    UPDATE agency_admins SET director_id = v_director WHERE id = NEW.id AND director_id IS NULL;
  ELSE
    -- O gatilho do diretor acha este Admin pelo e-mail e faz a ligação.
    INSERT INTO directors (id, agency_id, name, email, user_id, active, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.agency_id, NEW.name, NEW.email, NEW.user_id, NEW.active,
            coalesce(app.current_user_id(), NEW.created_by, NEW.user_id), now(), now());
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION agency_admins_add_director() FROM PUBLIC;
CREATE TRIGGER agency_admins_add_director
  AFTER INSERT ON agency_admins
  FOR EACH ROW WHEN (NEW.role = 'ADMIN' AND NEW.director_id IS NULL)
  EXECUTE FUNCTION agency_admins_add_director();

-- Nome, ativo e conta: o que muda num lado muda no outro.
CREATE FUNCTION directors_sync_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE agency_admins a
     SET name = NEW.name, active = NEW.active, user_id = coalesce(a.user_id, NEW.user_id), updated_at = now()
   WHERE a.director_id = NEW.id
     AND (a.name IS DISTINCT FROM NEW.name OR a.active IS DISTINCT FROM NEW.active OR (a.user_id IS NULL AND NEW.user_id IS NOT NULL));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION directors_sync_admin() FROM PUBLIC;
CREATE TRIGGER directors_sync_admin
  AFTER UPDATE OF name, active, user_id ON directors
  FOR EACH ROW EXECUTE FUNCTION directors_sync_admin();

CREATE FUNCTION agency_admins_sync_director() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE directors d
     SET name = NEW.name, active = NEW.active, user_id = coalesce(d.user_id, NEW.user_id), updated_at = now()
   WHERE d.id = NEW.director_id
     AND (d.name IS DISTINCT FROM NEW.name OR d.active IS DISTINCT FROM NEW.active OR (d.user_id IS NULL AND NEW.user_id IS NOT NULL));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION agency_admins_sync_director() FROM PUBLIC;
CREATE TRIGGER agency_admins_sync_director
  AFTER UPDATE OF name, active, user_id, director_id ON agency_admins
  FOR EACH ROW WHEN (NEW.director_id IS NOT NULL)
  EXECUTE FUNCTION agency_admins_sync_director();

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Diretor agora é Admin: só um diretor da própria agência cadastra, muda ou
-- desliga diretores (o Suporte vê, mas não mexe; a plataforma cuida pelo
-- lado do Admin, ao criar a agência).
DROP POLICY app_insert ON directors;
CREATE POLICY app_insert ON directors FOR INSERT TO core_app WITH CHECK (app.is_agency_full_admin(agency_id));
DROP POLICY app_update ON directors;
CREATE POLICY app_update ON directors FOR UPDATE TO core_app
  USING (app.is_agency_full_admin(agency_id)) WITH CHECK (app.is_agency_full_admin(agency_id));
