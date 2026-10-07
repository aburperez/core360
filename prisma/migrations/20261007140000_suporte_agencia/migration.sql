-- Suporte da agência: alguém da equipe CORE 360 que a própria agência
-- autoriza a entrar para ajudar. Nos eventos da agência pode o que o Admin
-- pode (app.admin_agencies() já inclui o Suporte), mas não cadastra, convida
-- nem desativa Admins ou Suporte. Só um Admin da agência (role ADMIN)
-- cadastra ou desliga o Suporte; nem a plataforma consegue se autorizar.

-- CreateEnum
CREATE TYPE "agency_admin_role" AS ENUM ('ADMIN', 'SUPORTE');

-- AlterTable
ALTER TABLE "agency_admins" ADD COLUMN     "role" "agency_admin_role" NOT NULL DEFAULT 'ADMIN';

-- O papel não muda depois de criado (core_app nem tem UPDATE na coluna).
CREATE FUNCTION agency_admins_role_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'o papel (Admin ou Suporte) não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER agency_admins_role_frozen BEFORE UPDATE OF role ON agency_admins
  FOR EACH ROW EXECUTE FUNCTION agency_admins_role_frozen();

-- Admin de verdade da agência (sem o Suporte): é quem cuida da equipe de Admins.
CREATE FUNCTION app.is_agency_full_admin(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM agency_admins a
      JOIN agencies g ON g.id = a.agency_id
      JOIN users u    ON u.id = a.user_id
     WHERE a.agency_id = p_agency
       AND a.user_id = app.current_user_id()
       AND a.role = 'ADMIN'
       AND a.active AND u.active
       AND g.status = 'ACTIVE'
  )
$$;
REVOKE ALL ON FUNCTION app.is_agency_full_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_agency_full_admin(uuid) TO core_app, core_auth;

-- agency_admins: o Admin da agência cuida de Admins e Suporte; a plataforma
-- só de Admins (cria o primeiro). O Suporte não mexe em ninguém.
DROP POLICY app_insert ON agency_admins;
DROP POLICY app_update ON agency_admins;
CREATE POLICY app_insert ON agency_admins FOR INSERT TO core_app WITH CHECK (
  app.is_agency_full_admin(agency_id) OR (role = 'ADMIN' AND app.is_platform_admin())
);
CREATE POLICY app_update ON agency_admins FOR UPDATE TO core_app
  USING (app.is_agency_full_admin(agency_id) OR (role = 'ADMIN' AND app.is_platform_admin()))
  WITH CHECK (app.is_agency_full_admin(agency_id) OR (role = 'ADMIN' AND app.is_platform_admin()));

-- Convite: as mesmas regras de quem cadastra.
DROP POLICY app_insert ON agency_invitations;
CREATE POLICY app_insert ON agency_invitations FOR INSERT TO core_app WITH CHECK (
  created_by = app.current_user_id()
  AND (
    app.is_agency_full_admin(agency_id)
    OR (app.is_platform_admin() AND EXISTS (
      SELECT 1 FROM agency_admins a WHERE a.id = agency_admin_id AND a.role = 'ADMIN'
    ))
  )
);
