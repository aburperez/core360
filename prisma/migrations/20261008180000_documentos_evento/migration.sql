-- Central de documentos do evento (Pré-produção): arquivos com categoria.
-- A Pré-produção (Gerente, Pré-produtor e Admin) envia e vê todos. O gestor
-- (Gerente ou Admin) pode liberar um documento para o campo, que só lê.
-- Apaga quem enviou ou o gestor.

-- CreateEnum
CREATE TYPE "document_category" AS ENUM ('BRIEFING', 'PLANTA', 'MEMORIAL', 'MANUAL', 'IDENTIDADE_VISUAL', 'PROJETO_3D', 'ORCAMENTO_CLIENTE', 'CONTRATO', 'PEDIDO', 'NOTA_FISCAL', 'ART_RRT', 'LAUDO', 'SEGURO', 'CRONOGRAMA', 'MAPA', 'CHECKLIST', 'OUTRO');

-- CreateTable
CREATE TABLE "event_documents" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "category" "document_category" NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "visible_to_field" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_documents_storage_key_key" ON "event_documents"("storage_key");

-- CreateIndex
CREATE INDEX "event_documents_event_id_category_idx" ON "event_documents"("event_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "event_documents_event_id_sha256_key" ON "event_documents"("event_id", "sha256");

-- AddForeignKey
ALTER TABLE "event_documents" ADD CONSTRAINT "event_documents_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_documents" ADD CONSTRAINT "event_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE event_documents
  ADD CONSTRAINT event_documents_title CHECK (btrim(title) <> '' AND length(title) <= 200),
  ADD CONSTRAINT event_documents_file_name CHECK (btrim(file_name) <> '' AND length(file_name) <= 200),
  ADD CONSTRAINT event_documents_size CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  ADD CONSTRAINT event_documents_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- O arquivo, o evento e quem enviou não mudam. Liberar ou esconder do campo:
-- só o gestor.
CREATE FUNCTION event_documents_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.event_id <> OLD.event_id OR NEW.storage_key <> OLD.storage_key OR NEW.sha256 <> OLD.sha256
      OR NEW.uploaded_by <> OLD.uploaded_by OR NEW.size_bytes <> OLD.size_bytes OR NEW.mime_type <> OLD.mime_type) THEN
    RAISE EXCEPTION 'o arquivo do documento não muda; envie outro' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.visible_to_field AND (TG_OP = 'INSERT' OR NOT OLD.visible_to_field) AND NOT app.can_review_sla(NEW.event_id)
     OR TG_OP = 'UPDATE' AND OLD.visible_to_field AND NOT NEW.visible_to_field AND NOT app.can_review_sla(NEW.event_id) THEN
    RAISE EXCEPTION 'só o gestor libera documentos para o campo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_documents_guard() FROM PUBLIC;
CREATE TRIGGER event_documents_guard
  BEFORE INSERT OR UPDATE ON event_documents
  FOR EACH ROW EXECUTE FUNCTION event_documents_guard();

-- Apagou o documento: os bytes guardados no banco vão junto (como dono).
CREATE FUNCTION event_documents_drop_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM stored_files WHERE key = OLD.storage_key;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION event_documents_drop_file() FROM PUBLIC;
CREATE TRIGGER event_documents_drop_file
  AFTER DELETE ON event_documents
  FOR EACH ROW EXECUTE FUNCTION event_documents_drop_file();

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE event_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_documents FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_documents TO core_app;

CREATE POLICY app_select ON event_documents FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR (visible_to_field AND app.can_use_field(event_id)));
CREATE POLICY app_insert ON event_documents FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND uploaded_by = app.current_user_id());
CREATE POLICY app_update ON event_documents FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON event_documents FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id) AND (app.can_review_sla(event_id) OR uploaded_by = app.current_user_id()));

-- O arquivo no banco: só de um documento que a pessoa enxerga.
CREATE POLICY app_select_event_document ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM event_documents d WHERE d.storage_key = stored_files.key)
);
