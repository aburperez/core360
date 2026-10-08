-- Relatório da visita técnica (pedido do Abu, 2026-10-08): a visita marcada
-- (quem vai, quando, EPIs) ganha o briefing do lugar, preenchido no local
-- (acesso e carga, energia, internet, banheiros e apoio, restrições, contatos,
-- observações), e as fotos com legenda.
--   • Toda a Pré-produção vê; mexe quem já mexe na visita (o gestor, quem
--     marcou ou quem vai).
--   • Para concluir, pelo menos 10 fotos; no máximo 40 por visita.
--   • Concluída, a visita fica travada até alguém reabrir.

-- CreateEnum
CREATE TYPE "visit_status" AS ENUM ('ABERTA', 'CONCLUIDA');

-- AlterTable
ALTER TABLE "technical_visits" ADD COLUMN     "access_text" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "concluded_at" TIMESTAMPTZ(3),
ADD COLUMN     "contacts_text" TEXT,
ADD COLUMN     "facilities_text" TEXT,
ADD COLUMN     "internet_text" TEXT,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "people" TEXT,
ADD COLUMN     "power_text" TEXT,
ADD COLUMN     "restrictions_text" TEXT,
ADD COLUMN     "status" "visit_status" NOT NULL DEFAULT 'ABERTA';

-- CreateTable
CREATE TABLE "technical_visit_photos" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technical_visit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "technical_visit_photos_storage_key_key" ON "technical_visit_photos"("storage_key");

-- CreateIndex
CREATE INDEX "technical_visit_photos_visit_id_position_idx" ON "technical_visit_photos"("visit_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "technical_visit_photos_visit_id_sha256_key" ON "technical_visit_photos"("visit_id", "sha256");

-- AddForeignKey
ALTER TABLE "technical_visit_photos" ADD CONSTRAINT "technical_visit_photos_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_visit_photos" ADD CONSTRAINT "technical_visit_photos_event_id_visit_id_fkey" FOREIGN KEY ("event_id", "visit_id") REFERENCES "technical_visits"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE technical_visits
  ADD CONSTRAINT technical_visits_concluded CHECK ((status = 'CONCLUIDA') = (concluded_at IS NOT NULL));

ALTER TABLE technical_visit_photos
  ADD CONSTRAINT technical_visit_photos_size CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  ADD CONSTRAINT technical_visit_photos_caption CHECK (caption IS NULL OR length(caption) <= 300);

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Mexer na visita: o gestor, quem marcou ou quem vai (a mesma regra da
-- política app_update de technical_visits).
CREATE FUNCTION app.can_edit_visit(p_event uuid, p_created_by uuid, p_responsible uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_use_pre_production(p_event) AND (
    app.can_review_sla(p_event) OR p_created_by = app.current_user_id() OR coalesce(app.is_me(p_event, p_responsible), false))
$$;
REVOKE ALL ON FUNCTION app.can_edit_visit(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_edit_visit(uuid, uuid, uuid) TO core_app;

ALTER TABLE technical_visit_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technical_visit_photos FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON technical_visit_photos TO core_app;

CREATE POLICY app_select ON technical_visit_photos FOR SELECT TO core_app USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON technical_visit_photos FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id() AND EXISTS (
    SELECT 1 FROM technical_visits v
     WHERE v.id = technical_visit_photos.visit_id AND app.can_edit_visit(v.event_id, v.created_by, v.responsible_id))
);
CREATE POLICY app_update ON technical_visit_photos FOR UPDATE TO core_app USING (
  EXISTS (SELECT 1 FROM technical_visits v
           WHERE v.id = technical_visit_photos.visit_id AND app.can_edit_visit(v.event_id, v.created_by, v.responsible_id))
);
CREATE POLICY app_delete ON technical_visit_photos FOR DELETE TO core_app USING (
  EXISTS (SELECT 1 FROM technical_visits v
           WHERE v.id = technical_visit_photos.visit_id AND app.can_edit_visit(v.event_id, v.created_by, v.responsible_id))
);

-- Os bytes (arquivos guardados no banco): quem vê a foto da visita.
CREATE POLICY app_select_visit_photo ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM technical_visit_photos p WHERE p.storage_key = stored_files.key)
);

-- A visita: o evento e quem marcou não mudam; concluir pede 10 fotos;
-- concluída, nada muda até reabrir. Conta as fotos como dono (sem RLS).
CREATE FUNCTION technical_visits_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  photos int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CONCLUIDA' THEN
      RAISE EXCEPTION 'reabra a visita antes de apagar' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a visita não muda de evento nem de quem marcou' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CONCLUIDA' AND NEW.status = 'CONCLUIDA'
     AND (NEW.title, NEW.place, NEW.scheduled_at, NEW.responsible_id, NEW.ppe, NEW.ppe_other, NEW.notes, NEW.address,
          NEW.people, NEW.access_text, NEW.power_text, NEW.internet_text, NEW.facilities_text, NEW.restrictions_text,
          NEW.contacts_text, NEW.observations, NEW.concluded_at)
         IS DISTINCT FROM
         (OLD.title, OLD.place, OLD.scheduled_at, OLD.responsible_id, OLD.ppe, OLD.ppe_other, OLD.notes, OLD.address,
          OLD.people, OLD.access_text, OLD.power_text, OLD.internet_text, OLD.facilities_text, OLD.restrictions_text,
          OLD.contacts_text, OLD.observations, OLD.concluded_at)
  THEN
    RAISE EXCEPTION 'visita concluída: reabra para mudar' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CONCLUIDA' AND OLD.status <> 'CONCLUIDA' THEN
    SELECT count(*) INTO photos FROM technical_visit_photos WHERE visit_id = NEW.id;
    IF photos < 10 THEN
      RAISE EXCEPTION 'a visita precisa de pelo menos 10 fotos (tem %)', photos USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER technical_visits_guard
  BEFORE UPDATE OR DELETE ON technical_visits
  FOR EACH ROW EXECUTE FUNCTION technical_visits_guard();

-- Fotos: só com a visita aberta, no máximo 40, sempre da mesma visita. Trava a
-- visita para duas pessoas ao mesmo tempo não passarem do limite.
CREATE FUNCTION technical_visit_photos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v technical_visits%ROWTYPE;
  photos int;
BEGIN
  SELECT * INTO v FROM technical_visits WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.visit_id ELSE NEW.visit_id END) FOR UPDATE;
  -- Apagando a visita inteira (cascata): a visita já saiu.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'visita não encontrada' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v.status = 'CONCLUIDA' THEN
    RAISE EXCEPTION 'visita concluída: reabra para mudar as fotos' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.event_id, NEW.visit_id, NEW.storage_key, NEW.mime_type, NEW.size_bytes, NEW.sha256, NEW.uploaded_by)
     IS DISTINCT FROM (OLD.event_id, OLD.visit_id, OLD.storage_key, OLD.mime_type, OLD.size_bytes, OLD.sha256, OLD.uploaded_by)
  THEN
    RAISE EXCEPTION 'da foto só mudam a legenda e a ordem' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO photos FROM technical_visit_photos WHERE visit_id = NEW.visit_id;
    IF photos >= 40 THEN
      RAISE EXCEPTION 'no máximo 40 fotos por visita' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER technical_visit_photos_guard
  BEFORE INSERT OR UPDATE OR DELETE ON technical_visit_photos
  FOR EACH ROW EXECUTE FUNCTION technical_visit_photos_guard();

REVOKE ALL ON FUNCTION technical_visits_guard(), technical_visit_photos_guard() FROM PUBLIC;
