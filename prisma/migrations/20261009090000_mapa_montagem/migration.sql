-- CreateEnum
CREATE TYPE "arrival_status" AS ENUM ('AGENDADO', 'CHEGOU', 'MONTANDO', 'MONTADO', 'RETIRADO');

-- CreateTable
CREATE TABLE "arrivals" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "contract_id" UUID,
    "supplier_id" UUID,
    "supplier_name" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "vehicle" TEXT,
    "plate" TEXT,
    "driver" TEXT,
    "driver_phone" TEXT,
    "dock" TEXT,
    "area_id" UUID,
    "responsible_id" UUID,
    "notes" TEXT,
    "status" "arrival_status" NOT NULL DEFAULT 'AGENDADO',
    "arrived_at" TIMESTAMPTZ(3),
    "arrived_by" UUID,
    "status_at" TIMESTAMPTZ(3),
    "status_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "arrivals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arrival_items" (
    "id" UUID NOT NULL,
    "arrival_id" UUID NOT NULL,
    "cost_item_id" UUID,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3),
    "unit" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrival_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arrivals_contract_id_key" ON "arrivals"("contract_id");

-- CreateIndex
CREATE INDEX "arrivals_event_id_scheduled_at_idx" ON "arrivals"("event_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "arrival_items_arrival_id_cost_item_id_key" ON "arrival_items"("arrival_id", "cost_item_id");

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_area_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_responsible_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_arrived_by_fkey" FOREIGN KEY ("arrived_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_status_by_fkey" FOREIGN KEY ("status_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_items" ADD CONSTRAINT "arrival_items_arrival_id_fkey" FOREIGN KEY ("arrival_id") REFERENCES "arrivals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_items" ADD CONSTRAINT "arrival_items_cost_item_id_fkey" FOREIGN KEY ("cost_item_id") REFERENCES "cost_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────── Regras ───────────────────────────────

ALTER TABLE arrivals
  ADD CONSTRAINT arrivals_supplier_name_len CHECK (char_length(btrim(supplier_name)) BETWEEN 1 AND 160),
  ADD CONSTRAINT arrivals_period CHECK (scheduled_at IS NULL OR ends_at IS NULL OR ends_at >= scheduled_at),
  ADD CONSTRAINT arrivals_texts CHECK (
    coalesce(char_length(vehicle), 0) <= 80 AND coalesce(char_length(plate), 0) <= 20 AND coalesce(char_length(driver), 0) <= 120
    AND coalesce(char_length(driver_phone), 0) <= 30 AND coalesce(char_length(dock), 0) <= 80 AND coalesce(char_length(notes), 0) <= 1000
  ),
  -- Chegou (e o que vem depois) guarda a hora e quem marcou.
  ADD CONSTRAINT arrivals_arrived CHECK ((status = 'AGENDADO') = (arrived_at IS NULL) AND (arrived_at IS NULL) = (arrived_by IS NULL)),
  ADD CONSTRAINT arrivals_status_by CHECK ((status_at IS NULL) = (status_by IS NULL));
ALTER TABLE arrival_items
  ADD CONSTRAINT arrival_items_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Quem vê a chegada: a Pré-produção, o Admin, o Gerente, o Head da área e o responsável.
CREATE FUNCTION app.can_see_arrival(p_event uuid, p_area uuid, p_responsible uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_use_pre_production(p_event) OR app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND p_area IS NOT NULL AND m.area_id = p_area)
        OR (p_responsible IS NOT NULL AND m.participant_id = p_responsible AND m.role IN ('HEAD', 'OPERACIONAL'))
  )
$$;
REVOKE ALL ON FUNCTION app.can_see_arrival(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_see_arrival(uuid, uuid, uuid) TO core_app;

ALTER TABLE arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrival_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arrivals, arrival_items FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON arrivals, arrival_items TO core_app;

-- Criar e apagar: a Pré-produção. Mudar: quem vê (o campo só o status; ver o gatilho).
CREATE POLICY app_select ON arrivals FOR SELECT TO core_app USING (app.can_see_arrival(event_id, area_id, responsible_id));
CREATE POLICY app_insert ON arrivals FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON arrivals FOR UPDATE TO core_app
  USING (app.can_see_arrival(event_id, area_id, responsible_id)) WITH CHECK (app.can_see_arrival(event_id, area_id, responsible_id));
CREATE POLICY app_delete ON arrivals FOR DELETE TO core_app USING (app.can_use_pre_production(event_id));

CREATE POLICY app_select ON arrival_items FOR SELECT TO core_app
  USING (EXISTS (SELECT 1 FROM arrivals a WHERE a.id = arrival_items.arrival_id));
CREATE POLICY app_insert ON arrival_items FOR INSERT TO core_app
  WITH CHECK (EXISTS (SELECT 1 FROM arrivals a WHERE a.id = arrival_items.arrival_id AND app.can_use_pre_production(a.event_id)));
CREATE POLICY app_update ON arrival_items FOR UPDATE TO core_app
  USING (EXISTS (SELECT 1 FROM arrivals a WHERE a.id = arrival_items.arrival_id AND app.can_use_pre_production(a.event_id)));
CREATE POLICY app_delete ON arrival_items FOR DELETE TO core_app
  USING (EXISTS (SELECT 1 FROM arrivals a WHERE a.id = arrival_items.arrival_id AND app.can_use_pre_production(a.event_id)));

-- O campo só muda o status (e a hora em que chegou); o resto é da
-- Pré-produção. A chegada não muda de evento nem de contrato. Chegou e status
-- ficam no nome de quem marcou.
CREATE FUNCTION arrivals_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id <> OLD.event_id OR NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'A chegada não muda de evento nem de contrato' USING ERRCODE = '23514';
    END IF;
    IF NOT app.can_use_pre_production(NEW.event_id) AND
       (NEW.supplier_id, NEW.supplier_name, NEW.scheduled_at, NEW.ends_at, NEW.vehicle, NEW.plate, NEW.driver, NEW.driver_phone,
        NEW.dock, NEW.area_id, NEW.responsible_id, NEW.notes)
       IS DISTINCT FROM
       (OLD.supplier_id, OLD.supplier_name, OLD.scheduled_at, OLD.ends_at, OLD.vehicle, OLD.plate, OLD.driver, OLD.driver_phone,
        OLD.dock, OLD.area_id, OLD.responsible_id, OLD.notes)
    THEN
      RAISE EXCEPTION 'No campo só se muda o status da chegada' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.arrived_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.arrived_by IS DISTINCT FROM OLD.arrived_by OR NEW.arrived_at IS DISTINCT FROM OLD.arrived_at)
     AND NEW.arrived_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'A chegada fica no nome de quem marcou' USING ERRCODE = '42501';
  END IF;
  IF NEW.status_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status_by IS DISTINCT FROM OLD.status_by OR NEW.status_at IS DISTINCT FROM OLD.status_at)
     AND NEW.status_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'O status fica no nome de quem marcou' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION arrivals_guard() FROM PUBLIC;
CREATE TRIGGER arrivals_guard
  BEFORE INSERT OR UPDATE ON arrivals
  FOR EACH ROW EXECUTE FUNCTION arrivals_guard();

-- O item da chegada é do mesmo evento.
CREATE FUNCTION arrival_items_same_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.cost_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cost_items ci JOIN arrivals a ON a.event_id = ci.event_id
     WHERE ci.id = NEW.cost_item_id AND a.id = NEW.arrival_id
  ) THEN
    RAISE EXCEPTION 'O item é de outro evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION arrival_items_same_event() FROM PUBLIC;
CREATE TRIGGER arrival_items_same_event
  BEFORE INSERT OR UPDATE OF cost_item_id, arrival_id ON arrival_items
  FOR EACH ROW EXECUTE FUNCTION arrival_items_same_event();

-- O responsável é alguém do campo neste evento.
CREATE FUNCTION arrivals_check_responsible() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.responsible_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id AND p.active AND p.deleted_at IS NULL
       AND p.role IN ('GERENTE', 'HEAD', 'OPERACIONAL')
  ) THEN
    RAISE EXCEPTION 'O responsável precisa ser do campo neste evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION arrivals_check_responsible() FROM PUBLIC;
CREATE TRIGGER arrivals_check_responsible
  BEFORE INSERT OR UPDATE OF responsible_id ON arrivals
  FOR EACH ROW EXECUTE FUNCTION arrivals_check_responsible();

-- ──────────────────── Nasce do contrato assinado ────────────────────

-- Uma chegada por contrato, com os itens dele (nome e quantidade). A área
-- vem junto quando todos os itens são da mesma área.
CREATE FUNCTION arrival_from_contract(p_contract uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c contracts%ROWTYPE;
  v_id uuid;
  v_areas uuid[];
BEGIN
  SELECT * INTO c FROM contracts WHERE id = p_contract;
  IF c.id IS NULL OR c.status <> 'ASSINADO' OR EXISTS (SELECT 1 FROM arrivals WHERE contract_id = c.id) THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT it.area_id) FILTER (WHERE it.area_id IS NOT NULL) INTO v_areas
    FROM contract_items ci
    JOIN supplier_quotes sq ON sq.id = ci.quote_id
    JOIN quote_requests qr  ON qr.id = sq.request_id
    JOIN cost_items it      ON it.id = qr.cost_item_id
   WHERE ci.contract_id = c.id;
  INSERT INTO arrivals (id, event_id, contract_id, supplier_id, supplier_name, area_id, updated_at)
  SELECT gen_random_uuid(), c.event_id, c.id, s.id, coalesce(nullif(btrim(s.trade_name), ''), s.company_name),
         CASE WHEN cardinality(v_areas) = 1 THEN v_areas[1] END, now()
    FROM suppliers s WHERE s.id = c.supplier_id
  RETURNING id INTO v_id;
  INSERT INTO arrival_items (id, arrival_id, cost_item_id, name, quantity, unit)
  SELECT DISTINCT ON (it.id) gen_random_uuid(), v_id, it.id, it.name, it.quantity, it.unit
    FROM contract_items ci
    JOIN supplier_quotes sq ON sq.id = ci.quote_id
    JOIN quote_requests qr  ON qr.id = sq.request_id
    JOIN cost_items it      ON it.id = qr.cost_item_id
   WHERE ci.contract_id = c.id
   ORDER BY it.id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION arrival_from_contract(uuid) FROM PUBLIC;

CREATE FUNCTION contracts_create_arrival() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM arrival_from_contract(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION contracts_create_arrival() FROM PUBLIC;
CREATE TRIGGER contracts_create_arrival
  AFTER INSERT OR UPDATE OF status ON contracts
  FOR EACH ROW WHEN (NEW.status = 'ASSINADO')
  EXECUTE FUNCTION contracts_create_arrival();

-- Os contratos já assinados ganham a chegada.
SELECT arrival_from_contract(c.id) FROM contracts c JOIN events e ON e.id = c.event_id
 WHERE c.status = 'ASSINADO' AND e.deleted_at IS NULL;
