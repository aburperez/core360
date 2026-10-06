-- Itens no campo (pedido do Abu, 2026-10-06): a planilha de custos da
-- Pré-produção alimenta o campo. O Gerente escolhe quem recebe cada item e
-- "envia para o campo"; quem recebe confere (chegou certo / diferente) e
-- acerta quantidade e descrição. O campo NUNCA vê valores: o que vai para
-- ele é uma cópia sem preços (item_receipts), e cost_items continua só da
-- Pré-produção. Valor unitário em branco = "a definir" (fora dos totais).

-- CreateEnum
CREATE TYPE "receipt_status" AS ENUM ('PENDENTE', 'OK', 'DIFERENTE');

-- AlterTable
ALTER TABLE "cost_items" ADD COLUMN     "receiver_id" UUID,
ALTER COLUMN "unit_value" DROP NOT NULL;

-- CreateTable
CREATE TABLE "item_receipts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "cost_item_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "section_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "status" "receipt_status" NOT NULL DEFAULT 'PENDENTE',
    "received_quantity" DECIMAL(12,3),
    "received_description" TEXT,
    "note" TEXT,
    "received_at" TIMESTAMPTZ(3),
    "received_by" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "item_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_photos" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_receipts_cost_item_id_key" ON "item_receipts"("cost_item_id");

-- CreateIndex
CREATE INDEX "item_receipts_event_id_receiver_id_idx" ON "item_receipts"("event_id", "receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_receipts_event_id_id_key" ON "item_receipts"("event_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_receipts_event_id_cost_item_id_key" ON "item_receipts"("event_id", "cost_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_photos_storage_key_key" ON "receipt_photos"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_photos_receipt_id_sha256_key" ON "receipt_photos"("receipt_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "cost_items_event_id_id_key" ON "cost_items"("event_id", "id");

-- AddForeignKey
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_event_id_receiver_id_fkey" FOREIGN KEY ("event_id", "receiver_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_event_id_cost_item_id_fkey" FOREIGN KEY ("event_id", "cost_item_id") REFERENCES "cost_items"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_event_id_receiver_id_fkey" FOREIGN KEY ("event_id", "receiver_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_photos" ADD CONSTRAINT "receipt_photos_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_photos" ADD CONSTRAINT "receipt_photos_event_id_receipt_id_fkey" FOREIGN KEY ("event_id", "receipt_id") REFERENCES "item_receipts"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE item_receipts
  ADD CONSTRAINT item_receipts_quantity_nonneg CHECK (quantity >= 0),
  ADD CONSTRAINT item_receipts_received_quantity_nonneg CHECK (received_quantity IS NULL OR received_quantity >= 0),
  ADD CONSTRAINT item_receipts_name_not_blank CHECK (btrim(name) <> ''),
  -- Conferido = quem e quando; "chegou diferente" pede a explicação.
  ADD CONSTRAINT item_receipts_checked CHECK (
    (status = 'PENDENTE' AND received_at IS NULL AND received_by IS NULL)
    OR (status <> 'PENDENTE' AND received_at IS NOT NULL AND received_by IS NOT NULL)
  ),
  ADD CONSTRAINT item_receipts_difference_explained CHECK (status <> 'DIFERENTE' OR btrim(coalesce(note, '')) <> '');

ALTER TABLE receipt_photos
  ADD CONSTRAINT receipt_photos_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Quem manda para o campo e escolhe quem recebe: o gestor (Gerente ou Admin).
CREATE FUNCTION app.can_send_to_field(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

-- A pessoa que recebe é a própria participação de quem está logado.
CREATE FUNCTION app.is_me(p_event uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.participant_id = p_participant)
$$;

REVOKE ALL ON FUNCTION app.can_send_to_field(uuid), app.is_me(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_send_to_field(uuid), app.is_me(uuid, uuid) TO core_app;

-- Quem recebe o item: só o gestor escolhe, e precisa ser alguém do campo
-- (Gerente, Head ou Operacional) ativo no evento.
CREATE FUNCTION cost_items_guard_receiver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.receiver_id IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.receiver_id END) THEN
    RETURN NEW;
  END IF;
  IF app.current_user_id() IS NOT NULL AND NOT app.can_send_to_field(NEW.event_id) THEN
    RAISE EXCEPTION 'só o gerente escolhe quem recebe' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.receiver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.receiver_id AND p.event_id = NEW.event_id
       AND p.active AND p.deleted_at IS NULL
       AND p.role IN ('GERENTE', 'HEAD', 'OPERACIONAL')
  ) THEN
    RAISE EXCEPTION 'quem recebe precisa ser do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cost_items_guard_receiver
  BEFORE INSERT OR UPDATE OF receiver_id ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_guard_receiver();

ALTER TABLE item_receipts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON item_receipts, receipt_photos FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON item_receipts TO core_app;
GRANT SELECT, INSERT ON receipt_photos TO core_app;

-- Ver: a Pré-produção (para acompanhar na planilha) e quem recebe.
CREATE POLICY app_select ON item_receipts FOR SELECT TO core_app USING (
  app.can_use_pre_production(event_id) OR app.is_me(event_id, receiver_id)
);
-- Enviar, reenviar e retirar: só o gestor.
CREATE POLICY app_insert ON item_receipts FOR INSERT TO core_app
  WITH CHECK (app.can_send_to_field(event_id) AND sent_by = app.current_user_id());
CREATE POLICY app_delete ON item_receipts FOR DELETE TO core_app
  USING (app.can_send_to_field(event_id));
-- Conferir: quem recebe (ou o gestor). O que cada um pode mudar vem no gatilho abaixo.
CREATE POLICY app_update ON item_receipts FOR UPDATE TO core_app
  USING (app.can_send_to_field(event_id) OR app.is_me(event_id, receiver_id))
  WITH CHECK (app.can_send_to_field(event_id) OR app.is_me(event_id, receiver_id));

-- Quem recebe só mexe na conferência; o item enviado (nome, quantidade,
-- pessoa, seção) só o gestor muda. A conferência fica no nome de quem fez.
CREATE FUNCTION item_receipts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT app.can_send_to_field(NEW.event_id) AND (
       NEW.event_id     IS DISTINCT FROM OLD.event_id
    OR NEW.cost_item_id IS DISTINCT FROM OLD.cost_item_id
    OR NEW.receiver_id  IS DISTINCT FROM OLD.receiver_id
    OR NEW.section_name IS DISTINCT FROM OLD.section_name
    OR NEW.position     IS DISTINCT FROM OLD.position
    OR NEW.name         IS DISTINCT FROM OLD.name
    OR NEW.description  IS DISTINCT FROM OLD.description
    OR NEW.quantity     IS DISTINCT FROM OLD.quantity
    OR NEW.sent_at      IS DISTINCT FROM OLD.sent_at
    OR NEW.sent_by      IS DISTINCT FROM OLD.sent_by
  ) THEN
    RAISE EXCEPTION 'só o gerente muda o item enviado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.received_by IS DISTINCT FROM OLD.received_by
     AND NEW.received_by IS NOT NULL AND NEW.received_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'a conferência fica no nome de quem fez' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER item_receipts_guard
  BEFORE UPDATE ON item_receipts
  FOR EACH ROW EXECUTE FUNCTION item_receipts_guard();

-- Fotos da conferência: quem vê o recebimento vê a foto; quem recebe (ou o gestor) envia.
CREATE POLICY app_select ON receipt_photos FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM item_receipts r WHERE r.id = receipt_photos.receipt_id)
);
CREATE POLICY app_insert ON receipt_photos FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id()
  AND EXISTS (
    SELECT 1 FROM item_receipts r
     WHERE r.id = receipt_photos.receipt_id
       AND (app.can_send_to_field(r.event_id) OR app.is_me(r.event_id, r.receiver_id))
  )
);

-- Os bytes da foto (fotos guardadas no banco): mesma regra.
CREATE POLICY app_select_receipt ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM receipt_photos p WHERE p.storage_key = stored_files.key)
);
