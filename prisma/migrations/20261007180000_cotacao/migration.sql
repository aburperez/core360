-- Pré-produção: cotação. Um pedido de cotação (descritivo que vai por e-mail
-- aos fornecedores), até 3 orçamentos com os dados do fornecedor e o arquivo,
-- o prazo que o gestor define depois do envio e a escolha do vencedor.
-- Só a Pré-produção (Gerente, Pré-produtor e Admin) vê, como a planilha de custos.

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('ABERTA', 'ENVIADA', 'FECHADA', 'CANCELADA');
-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'COTACAO';
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "link" TEXT;
-- CreateTable
CREATE TABLE "quote_requests" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "briefing" TEXT NOT NULL,
    "responsible_id" UUID NOT NULL,
    "cost_item_id" UUID,
    "status" "quote_status" NOT NULL DEFAULT 'ABERTA',
    "sent_at" TIMESTAMPTZ(3),
    "sent_by" UUID,
    "sla_minutes" INTEGER,
    "due_at" TIMESTAMPTZ(3),
    "sla_set_at" TIMESTAMPTZ(3),
    "sla_set_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "chosen_quote_id" UUID,
    "chosen_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "cnpj" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL,
    "payment_terms" TEXT,
    "notes" TEXT,
    "file_key" TEXT,
    "file_name" TEXT,
    "file_mime" TEXT,
    "file_size" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "quote_requests_event_id_status_idx" ON "quote_requests"("event_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_event_id_id_key" ON "quote_requests"("event_id", "id");
-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_file_key_key" ON "supplier_quotes"("file_key");
-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_request_id_position_key" ON "supplier_quotes"("request_id", "position");
-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_request_id_id_key" ON "supplier_quotes"("request_id", "id");
-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_event_id_id_key" ON "supplier_quotes"("event_id", "id");
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_event_id_responsible_id_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_event_id_cost_item_id_fkey" FOREIGN KEY ("event_id", "cost_item_id") REFERENCES "cost_items"("event_id", "id") ON DELETE SET NULL ("cost_item_id") ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_id_chosen_quote_id_fkey" FOREIGN KEY ("id", "chosen_quote_id") REFERENCES "supplier_quotes"("request_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_sla_set_by_fkey" FOREIGN KEY ("sla_set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_event_id_request_id_fkey" FOREIGN KEY ("event_id", "request_id") REFERENCES "quote_requests"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE quote_requests
  ADD CONSTRAINT quote_requests_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT quote_requests_briefing_not_blank CHECK (btrim(briefing) <> ''),
  ADD CONSTRAINT quote_requests_sla_range CHECK (sla_minutes IS NULL OR sla_minutes BETWEEN 1 AND 129600),
  ADD CONSTRAINT quote_requests_sla_complete CHECK ((sla_minutes IS NULL) = (due_at IS NULL)),
  ADD CONSTRAINT quote_requests_sent CHECK (status = 'ABERTA' OR status = 'CANCELADA' OR sent_at IS NOT NULL),
  ADD CONSTRAINT quote_requests_closed CHECK ((status = 'FECHADA') = (chosen_quote_id IS NOT NULL));

ALTER TABLE supplier_quotes
  ADD CONSTRAINT supplier_quotes_position_range CHECK (position BETWEEN 1 AND 3),
  ADD CONSTRAINT supplier_quotes_cnpj_digits CHECK (cnpj ~ '^[0-9]{14}$'),
  ADD CONSTRAINT supplier_quotes_company_not_blank CHECK (btrim(company_name) <> ''),
  ADD CONSTRAINT supplier_quotes_contact_not_blank CHECK (btrim(contact_name) <> ''),
  ADD CONSTRAINT supplier_quotes_value_nonneg CHECK (total_value >= 0),
  ADD CONSTRAINT supplier_quotes_file_complete CHECK ((file_key IS NULL) = (file_name IS NULL) AND (file_key IS NULL) = (file_mime IS NULL) AND (file_key IS NULL) = (file_size IS NULL));

-- Quem cuida da cotação é da Pré-produção do evento (Gerente ou Pré-produtor).
CREATE FUNCTION quote_requests_responsible_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id
       AND p.role IN ('GERENTE', 'PRE_PRODUTOR') AND p.active AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Quem cuida da cotação precisa ser Gerente ou Pré-produtor do evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION quote_requests_responsible_check() FROM PUBLIC;
CREATE TRIGGER quote_requests_responsible_check
  BEFORE INSERT OR UPDATE OF responsible_id ON quote_requests
  FOR EACH ROW EXECUTE FUNCTION quote_requests_responsible_check();

-- O prazo e a escolha do orçamento são do gestor (Gerente ou Admin), também no banco.
CREATE FUNCTION quote_requests_manager_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'core_app' AND NOT app.can_review_sla(NEW.event_id) AND (
       NEW.sla_minutes IS DISTINCT FROM OLD.sla_minutes OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.chosen_quote_id IS DISTINCT FROM OLD.chosen_quote_id OR NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('FECHADA', 'CANCELADA') OR OLD.status IN ('FECHADA', 'CANCELADA'))
  ) THEN
    RAISE EXCEPTION 'Só o gestor define o prazo, escolhe, cancela ou reabre a cotação' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION quote_requests_manager_fields() FROM PUBLIC;
CREATE TRIGGER quote_requests_manager_fields
  BEFORE UPDATE ON quote_requests
  FOR EACH ROW EXECUTE FUNCTION quote_requests_manager_fields();

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE quote_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quote_requests, supplier_quotes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON quote_requests TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_quotes TO core_app;

CREATE POLICY app_select ON quote_requests FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON quote_requests FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON quote_requests FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));

CREATE POLICY app_select ON supplier_quotes FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON supplier_quotes FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON supplier_quotes FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON supplier_quotes FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));

-- O arquivo do orçamento (arquivos guardados no banco): mesma regra.
CREATE POLICY app_select_quote ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM supplier_quotes q WHERE q.file_key = stored_files.key)
);

-- ─────────────────────────────── Avisos ───────────────────────────────
-- core_app não grava avisos de outras pessoas. Esta função grava só os avisos
-- da cotação, montados aqui a partir do próprio pedido, e só para quem é da
-- Pré-produção dele:
--   ENVIADA   -> gestores (definir o prazo)
--   PRAZO     -> quem cuida (o prazo definido)
--   RECEBIDOS -> gestores (3 orçamentos, comparar e escolher)
--   FECHADA   -> quem cuida (o orçamento escolhido)
-- Quem fez a ação não recebe o próprio aviso.
CREATE FUNCTION app.notify_quote(p_request uuid, p_kind text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r       quote_requests%ROWTYPE;
  ev      events%ROWTYPE;
  v_me    uuid := app.current_user_id();
  v_title text;
  v_body  text;
  v_key   text;
  v_n     integer := 0;
BEGIN
  SELECT * INTO r FROM quote_requests WHERE id = p_request;
  IF NOT FOUND OR v_me IS NULL OR NOT app.can_use_pre_production(r.event_id) THEN
    RAISE EXCEPTION 'Cotação não encontrada' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ev FROM events WHERE id = r.event_id;

  IF p_kind = 'ENVIADA' AND r.status = 'ENVIADA' THEN
    v_title := 'Cotação enviada: defina o prazo';
    v_body  := r.title || ' · ' || ev.name;
    v_key   := 'quote:' || r.id || ':enviada';
  ELSIF p_kind = 'RECEBIDOS' AND r.completed_at IS NOT NULL THEN
    v_title := '3 orçamentos recebidos: compare e escolha';
    v_body  := r.title || ' · ' || ev.name;
    v_key   := 'quote:' || r.id || ':recebidos:' || extract(epoch FROM r.completed_at)::bigint;
  ELSIF p_kind = 'PRAZO' AND r.due_at IS NOT NULL THEN
    v_title := 'Prazo da cotação: até ' || to_char(r.due_at AT TIME ZONE ev.timezone, 'DD/MM HH24:MI');
    v_body  := r.title || ' · ' || ev.name;
    v_key   := 'quote:' || r.id || ':prazo:' || extract(epoch FROM r.due_at)::bigint;
  ELSIF p_kind = 'FECHADA' AND r.status = 'FECHADA' THEN
    v_title := 'Cotação fechada: orçamento escolhido';
    v_body  := r.title || ' · ' || coalesce((SELECT company_name FROM supplier_quotes WHERE id = r.chosen_quote_id), '');
    v_key   := 'quote:' || r.id || ':fechada:' || extract(epoch FROM r.closed_at)::bigint;
  ELSE
    RETURN 0;
  END IF;

  INSERT INTO notifications (id, user_id, event_id, type, title, body, dedupe_key, link)
  SELECT gen_random_uuid(), p.user_id, r.event_id, 'COTACAO', v_title, v_body, v_key,
         '/eventos/' || r.event_id || '/pre-producao/cotacoes/' || r.id
    FROM participants p
    JOIN users u ON u.id = p.user_id AND u.active
   WHERE p.event_id = r.event_id AND p.active AND p.deleted_at IS NULL
     AND p.user_id IS DISTINCT FROM v_me
     AND CASE WHEN p_kind IN ('ENVIADA', 'RECEBIDOS') THEN p.role = 'GERENTE' ELSE p.id = r.responsible_id END
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION app.notify_quote(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.notify_quote(uuid, text) TO core_app;
