-- Painel de convites (Abu, 2026-10-17): o Admin da plataforma abre a agência
-- com o contato (nome, e-mail e celular) e manda o convite pelo WhatsApp. O
-- celular vai junto para o diretor que o banco cria para esse contato.

-- AlterTable
ALTER TABLE "agency_admins" ADD COLUMN     "phone" TEXT;

GRANT UPDATE (phone) ON agency_admins TO core_app;

CREATE OR REPLACE FUNCTION agency_admins_add_director() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_director uuid;
BEGIN
  SELECT id INTO v_director FROM directors WHERE agency_id = NEW.agency_id AND email = NEW.email;
  IF v_director IS NOT NULL THEN
    UPDATE agency_admins SET director_id = v_director WHERE id = NEW.id AND director_id IS NULL;
  ELSE
    -- O gatilho do diretor acha este Admin pelo e-mail e faz a ligação.
    INSERT INTO directors (id, agency_id, name, email, phone, user_id, active, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), NEW.agency_id, NEW.name, NEW.email, NEW.phone, NEW.user_id, NEW.active,
            coalesce(app.current_user_id(), NEW.created_by, NEW.user_id), now(), now());
  END IF;
  RETURN NULL;
END $$;
