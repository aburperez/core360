-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('RASCUNHO', 'ENVIADO', 'ASSINADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'RASCUNHO',
    "payment_terms" TEXT,
    "delivery_notes" TEXT,
    "notes" TEXT,
    "document_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "signed_on" DATE,
    "signed_by" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "cancelled_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_items" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contract_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_document_id_key" ON "contracts"("document_id");

-- CreateIndex
CREATE INDEX "contracts_supplier_id_idx" ON "contracts"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_event_id_number_key" ON "contracts"("event_id", "number");

-- CreateIndex
CREATE INDEX "contract_items_quote_id_idx" ON "contract_items"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_items_contract_id_quote_id_key" ON "contract_items"("contract_id", "quote_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "event_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_by_fkey" FOREIGN KEY ("signed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "supplier_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────── Regras ───────────────────────────────

ALTER TABLE contracts
  ADD CONSTRAINT contracts_number_positive CHECK (number > 0),
  ADD CONSTRAINT contracts_text_len CHECK (
    char_length(payment_terms) <= 500 AND char_length(delivery_notes) <= 1000
    AND char_length(notes) <= 2000 AND char_length(cancel_reason) <= 500
  ),
  ADD CONSTRAINT contracts_signed_complete CHECK (status <> 'ASSINADO' OR (signed_on IS NOT NULL AND signed_by IS NOT NULL)),
  ADD CONSTRAINT contracts_cancelled_complete CHECK (
    status <> 'CANCELADO' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancel_reason) <> '')
  );
ALTER TABLE contract_items ADD CONSTRAINT contract_items_value_nonneg CHECK (value >= 0);

-- Um contrato ativo por fornecedor no evento.
CREATE UNIQUE INDEX contracts_one_active_per_supplier ON contracts (event_id, supplier_id) WHERE status <> 'CANCELADO';

-- O pré-produtor monta e envia; só o diretor (gestor do evento) assina ou
-- cancela. Assinado e cancelado não mudam mais (o assinado só pode ser
-- cancelado). O texto só muda no rascunho; o PDF, no rascunho ou enviado.
CREATE FUNCTION contracts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RASCUNHO' THEN
      RAISE EXCEPTION 'Contrato novo começa como rascunho' USING ERRCODE = '23514';
    END IF;
    IF app.supplier_agency(NEW.supplier_id) IS DISTINCT FROM (SELECT agency_id FROM events WHERE id = NEW.event_id) THEN
      RAISE EXCEPTION 'Fornecedor de outra agência' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.supplier_id <> OLD.supplier_id OR NEW.number <> OLD.number OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'Evento, fornecedor e número do contrato não mudam' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Contrato cancelado não muda' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('ASSINADO', 'CANCELADO') AND NEW.status <> OLD.status AND NOT app.can_review_sla(NEW.event_id) THEN
    RAISE EXCEPTION 'Só o diretor assina ou cancela o contrato' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ASSINADO' AND NEW.status <> 'CANCELADO' THEN
    RAISE EXCEPTION 'Contrato assinado não muda; só pode ser cancelado' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ASSINADO' AND OLD.status <> 'ASSINADO' AND (
       NEW.document_id IS NULL OR NOT EXISTS (SELECT 1 FROM contract_items WHERE contract_id = NEW.id)) THEN
    RAISE EXCEPTION 'Para assinar, o contrato precisa do PDF e de pelo menos um item' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'RASCUNHO' AND (NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
       OR NEW.delivery_notes IS DISTINCT FROM OLD.delivery_notes OR NEW.notes IS DISTINCT FROM OLD.notes) THEN
    RAISE EXCEPTION 'Para mudar o texto, volte o contrato para rascunho' USING ERRCODE = '23514';
  END IF;
  IF OLD.status NOT IN ('RASCUNHO', 'ENVIADO') AND NEW.document_id IS DISTINCT FROM OLD.document_id THEN
    RAISE EXCEPTION 'O PDF só muda no rascunho ou enviado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION contracts_guard() FROM PUBLIC;
CREATE TRIGGER contracts_guard
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION contracts_guard();

-- Itens: só no rascunho; a proposta é aprovada, do mesmo evento e fornecedor e
-- não está em outro contrato ativo. O valor começa no da proposta (negociado,
-- se houver) e só o diretor muda.
CREATE FUNCTION contract_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c contracts%ROWTYPE;
  q supplier_quotes%ROWTYPE;
BEGIN
  IF current_user <> 'core_app' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT * INTO c FROM contracts WHERE id = COALESCE(NEW.contract_id, OLD.contract_id);
  IF c.status IS DISTINCT FROM 'RASCUNHO' THEN
    RAISE EXCEPTION 'Os itens só mudam com o contrato em rascunho' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.contract_id <> OLD.contract_id OR NEW.quote_id <> OLD.quote_id) THEN
    RAISE EXCEPTION 'O item do contrato não troca de proposta' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO q FROM supplier_quotes WHERE id = NEW.quote_id;
  IF TG_OP = 'INSERT' THEN
    IF q.id IS NULL OR q.status <> 'APROVADA' OR q.event_id <> c.event_id OR q.supplier_id <> c.supplier_id THEN
      RAISE EXCEPTION 'O item precisa ser uma proposta aprovada deste fornecedor no evento' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM contract_items i JOIN contracts o ON o.id = i.contract_id
                WHERE i.quote_id = NEW.quote_id AND o.status <> 'CANCELADO' AND o.id <> c.id) THEN
      RAISE EXCEPTION 'Esta proposta já está em outro contrato' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.value IS DISTINCT FROM COALESCE(q.negotiated_value, q.total_value)
      OR TG_OP = 'UPDATE' AND NEW.value IS DISTINCT FROM OLD.value) AND NOT app.can_review_sla(c.event_id) THEN
    RAISE EXCEPTION 'Só o diretor muda o valor do contrato' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION contract_items_guard() FROM PUBLIC;
CREATE TRIGGER contract_items_guard
  BEFORE INSERT OR UPDATE OR DELETE ON contract_items
  FOR EACH ROW EXECUTE FUNCTION contract_items_guard();

-- Proposta num contrato ativo não sai de Aprovada (reabrir a cotação pede
-- cancelar o contrato antes).
CREATE FUNCTION supplier_quotes_contract_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'APROVADA' AND NEW.status <> 'APROVADA' AND EXISTS (
       SELECT 1 FROM contract_items i JOIN contracts c ON c.id = i.contract_id
        WHERE i.quote_id = OLD.id AND c.status <> 'CANCELADO') THEN
    RAISE EXCEPTION 'A proposta está num contrato. Cancele o contrato antes de reabrir a cotação.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION supplier_quotes_contract_lock() FROM PUBLIC;
CREATE TRIGGER supplier_quotes_contract_lock
  BEFORE UPDATE OF status ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION supplier_quotes_contract_lock();

-- O PDF do contrato não vai para o campo, e o de um contrato enviado ou
-- assinado não pode ser apagado de Documentos.
CREATE FUNCTION event_documents_contract_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.visible_to_field AND EXISTS (SELECT 1 FROM contracts WHERE document_id = NEW.id) THEN
    RAISE EXCEPTION 'O PDF de contrato não é liberado para o campo' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM contracts WHERE document_id = OLD.id AND status IN ('ENVIADO', 'ASSINADO')) THEN
    RAISE EXCEPTION 'Este é o PDF de um contrato enviado ou assinado e não pode ser apagado' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION event_documents_contract_guard() FROM PUBLIC;
CREATE TRIGGER event_documents_contract_guard
  BEFORE UPDATE OR DELETE ON event_documents
  FOR EACH ROW EXECUTE FUNCTION event_documents_contract_guard();

-- ─────────────────────────────── Acesso ───────────────────────────────
-- Só a Pré-produção do evento (Gerente, Pré-produtor, Admin). Não se apaga
-- contrato: cancela.

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contracts, contract_items FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON contracts TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_items TO core_app;

CREATE POLICY app_select ON contracts FOR SELECT TO core_app USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON contracts FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON contracts FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id)) WITH CHECK (app.can_use_pre_production(event_id));

CREATE POLICY app_all ON contract_items TO core_app
  USING (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_items.contract_id AND app.can_use_pre_production(c.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_items.contract_id AND app.can_use_pre_production(c.event_id)));
