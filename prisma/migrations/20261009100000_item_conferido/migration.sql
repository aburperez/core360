-- CreateEnum
CREATE TYPE "receipt_photo_stage" AS ENUM ('RECEBIMENTO', 'CONFERIDO');

-- AlterTable
ALTER TABLE "item_receipts" ADD COLUMN     "area_id" UUID,
ADD COLUMN     "assembled_at" TIMESTAMPTZ(3),
ADD COLUMN     "assembled_by" UUID,
ADD COLUMN     "checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "checked_by" UUID;

-- AlterTable
ALTER TABLE "receipt_photos" ADD COLUMN     "stage" "receipt_photo_stage" NOT NULL DEFAULT 'RECEBIMENTO';

-- AddForeignKey
ALTER TABLE "item_receipts" ADD CONSTRAINT "item_receipts_area_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Fase 5B do roadmap (Abu, 2026-10-09): o item até Conferido. Recebimentos
-- continua pondo o item em No local. Depois o Head da área do item (ou o
-- gerente) marca Montado e então Conferido, que pede uma foto. Finalizado
-- continua só do diretor. O campo segue sem valores: tudo fica em
-- item_receipts, a cópia sem preços do item.

-- A área vem do item e o banco mantém a cópia em dia.
UPDATE item_receipts r SET area_id = i.area_id FROM cost_items i WHERE i.id = r.cost_item_id;

CREATE FUNCTION item_receipts_set_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.area_id := (SELECT area_id FROM cost_items WHERE id = NEW.cost_item_id);
  RETURN NEW;
END $$;
CREATE TRIGGER item_receipts_set_area
  BEFORE INSERT ON item_receipts
  FOR EACH ROW EXECUTE FUNCTION item_receipts_set_area();

CREATE FUNCTION cost_items_sync_receipt_area() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE item_receipts SET area_id = NEW.area_id WHERE cost_item_id = NEW.id AND area_id IS DISTINCT FROM NEW.area_id;
  RETURN NULL;
END $$;
CREATE TRIGGER cost_items_sync_receipt_area
  AFTER UPDATE OF area_id ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_sync_receipt_area();

-- Montado e Conferido: quem e quando; só depois da chegada, e nesta ordem.
ALTER TABLE item_receipts
  ADD CONSTRAINT item_receipts_assembled_pair CHECK ((assembled_at IS NULL) = (assembled_by IS NULL)),
  ADD CONSTRAINT item_receipts_checked_pair CHECK ((checked_at IS NULL) = (checked_by IS NULL)),
  ADD CONSTRAINT item_receipts_assembled_after_arrival CHECK (assembled_at IS NULL OR status <> 'PENDENTE'),
  ADD CONSTRAINT item_receipts_checked_after_assembled CHECK (checked_at IS NULL OR assembled_at IS NOT NULL);

-- Quem marca a montagem: o gestor (Gerente ou Admin) ou o Head da área do item.
CREATE FUNCTION app.can_assemble(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_send_to_field(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'HEAD' AND p_area IS NOT NULL AND m.area_id = p_area
  )
$$;
REVOKE ALL ON FUNCTION app.can_assemble(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_assemble(uuid, uuid) TO core_app;

-- O Head da área também vê e marca os itens da área dele.
DROP POLICY app_select ON item_receipts;
CREATE POLICY app_select ON item_receipts FOR SELECT TO core_app USING (
  app.can_use_pre_production(event_id) OR app.is_me(event_id, receiver_id) OR app.can_assemble(event_id, area_id)
);
DROP POLICY app_update ON item_receipts;
CREATE POLICY app_update ON item_receipts FOR UPDATE TO core_app
  USING (app.can_send_to_field(event_id) OR app.is_me(event_id, receiver_id) OR app.can_assemble(event_id, area_id))
  WITH CHECK (app.can_send_to_field(event_id) OR app.is_me(event_id, receiver_id) OR app.can_assemble(event_id, area_id));

DROP POLICY app_insert ON receipt_photos;
CREATE POLICY app_insert ON receipt_photos FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id()
  AND EXISTS (
    SELECT 1 FROM item_receipts r
     WHERE r.id = receipt_photos.receipt_id
       AND (app.can_send_to_field(r.event_id) OR app.is_me(r.event_id, r.receiver_id) OR app.can_assemble(r.event_id, r.area_id))
  )
);

-- Cada um mexe só na sua parte: o gestor no item enviado, quem recebe na
-- chegada, o Head da área (ou o gestor) na montagem. A área só muda pela
-- cópia automática. O Conferido pede uma foto do Conferido.
CREATE OR REPLACE FUNCTION item_receipts_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.area_id IS DISTINCT FROM OLD.area_id AND current_user = 'core_app' THEN
    RAISE EXCEPTION 'a área vem do item' USING ERRCODE = 'insufficient_privilege';
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
  IF NOT (app.can_send_to_field(NEW.event_id) OR app.is_me(NEW.event_id, NEW.receiver_id)) AND (
       NEW.status               IS DISTINCT FROM OLD.status
    OR NEW.received_quantity    IS DISTINCT FROM OLD.received_quantity
    OR NEW.received_description IS DISTINCT FROM OLD.received_description
    OR NEW.note                 IS DISTINCT FROM OLD.note
    OR NEW.received_at          IS DISTINCT FROM OLD.received_at
    OR NEW.received_by          IS DISTINCT FROM OLD.received_by
  ) THEN
    RAISE EXCEPTION 'só quem recebe confere a chegada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.received_by IS DISTINCT FROM OLD.received_by
     AND NEW.received_by IS NOT NULL AND NEW.received_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'a conferência fica no nome de quem fez' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.assembled_at IS DISTINCT FROM OLD.assembled_at OR NEW.assembled_by IS DISTINCT FROM OLD.assembled_by
      OR NEW.checked_at IS DISTINCT FROM OLD.checked_at OR NEW.checked_by IS DISTINCT FROM OLD.checked_by)
     AND NOT app.can_assemble(NEW.event_id, NEW.area_id) THEN
    RAISE EXCEPTION 'só o Head da área ou o gerente marca montado e conferido' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.assembled_by IS DISTINCT FROM OLD.assembled_by AND NEW.assembled_by IS NOT NULL AND NEW.assembled_by <> app.current_user_id())
     OR (NEW.checked_by IS DISTINCT FROM OLD.checked_by AND NEW.checked_by IS NOT NULL AND NEW.checked_by <> app.current_user_id()) THEN
    RAISE EXCEPTION 'a montagem fica no nome de quem marcou' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.checked_at IS NOT NULL AND OLD.checked_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM receipt_photos p WHERE p.receipt_id = NEW.id AND p.stage = 'CONFERIDO'
  ) THEN
    RAISE EXCEPTION 'o conferido pede uma foto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- O item acompanha o campo: chegou → No local, Montado, Conferido. Desfazer
-- Montado ou Conferido volta o item junto. Finalizado (do diretor) não muda.
CREATE OR REPLACE FUNCTION item_receipts_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_target item_status;
BEGIN
  v_target := CASE
    WHEN NEW.checked_at IS NOT NULL THEN 'CONFERIDO'
    WHEN NEW.assembled_at IS NOT NULL THEN 'MONTADO'
    WHEN NEW.status <> 'PENDENTE' THEN 'NO_LOCAL'
  END;
  IF v_target IS NULL THEN RETURN NULL; END IF;
  UPDATE cost_items SET status = v_target, updated_at = now()
   WHERE id = NEW.cost_item_id
     AND (status < v_target OR (status IN ('MONTADO', 'CONFERIDO') AND status > v_target));
  RETURN NULL;
END $$;
DROP TRIGGER item_receipts_item_status ON item_receipts;
CREATE TRIGGER item_receipts_item_status
  AFTER UPDATE OF status, assembled_at, checked_at ON item_receipts
  FOR EACH ROW EXECUTE FUNCTION item_receipts_item_status();
