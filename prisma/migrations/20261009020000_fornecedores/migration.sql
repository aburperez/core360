-- Fase 3A: cadastro de fornecedores da agência. Um fornecedor por CNPJ em cada
-- agência, usado em todos os eventos dela. Cada orçamento da cotação aponta para
-- um fornecedor do cadastro. A bonificação fica numa tabela à parte, que só o
-- diretor e o Head da área em que o fornecedor foi contratado enxergam.

-- CreateEnum
CREATE TYPE "bonus_kind" AS ENUM ('PERCENTUAL', 'VALOR');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "cnpj" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" CITEXT,
    "city" TEXT,
    "state" TEXT,
    "region" TEXT,
    "categories" "item_category"[] DEFAULT ARRAY[]::"item_category"[],
    "specialty" TEXT,
    "team" TEXT,
    "equipment" TEXT,
    "capacity" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bonuses" (
    "supplier_id" UUID NOT NULL,
    "kind" "bonus_kind" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_bonuses_pkey" PRIMARY KEY ("supplier_id")
);

-- CreateIndex
CREATE INDEX "suppliers_agency_id_company_name_idx" ON "suppliers"("agency_id", "company_name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_agency_id_cnpj_key" ON "suppliers"("agency_id", "cnpj");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bonuses" ADD CONSTRAINT "supplier_bonuses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bonuses" ADD CONSTRAINT "supplier_bonuses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────── Os fornecedores das cotações de hoje entram no cadastro ───────────────
-- Um por CNPJ em cada agência, com os dados do orçamento mais recente. As
-- categorias vêm dos itens a que as cotações dele estão ligadas.

INSERT INTO suppliers (id, agency_id, cnpj, company_name, contact_name, phone, email, created_by, created_at, updated_at)
SELECT DISTINCT ON (e.agency_id, sq.cnpj)
       gen_random_uuid(), e.agency_id, sq.cnpj, sq.company_name, sq.contact_name, sq.phone, sq.email, sq.created_by, sq.created_at, now()
  FROM supplier_quotes sq
  JOIN events e ON e.id = sq.event_id
 ORDER BY e.agency_id, sq.cnpj, sq.created_at DESC;

UPDATE suppliers s
   SET categories = c.cats
  FROM (
    SELECT e.agency_id, sq.cnpj, array_agg(DISTINCT ci.category) FILTER (WHERE ci.category IS NOT NULL) AS cats
      FROM supplier_quotes sq
      JOIN events e ON e.id = sq.event_id
      JOIN quote_requests qr ON qr.id = sq.request_id
      JOIN cost_items ci ON ci.id = qr.cost_item_id
     GROUP BY e.agency_id, sq.cnpj
  ) c
 WHERE c.agency_id = s.agency_id AND c.cnpj = s.cnpj AND c.cats IS NOT NULL;

ALTER TABLE "supplier_quotes" ADD COLUMN "supplier_id" UUID;

UPDATE supplier_quotes sq
   SET supplier_id = s.id
  FROM events e, suppliers s
 WHERE e.id = sq.event_id AND s.agency_id = e.agency_id AND s.cnpj = sq.cnpj;

ALTER TABLE "supplier_quotes" ALTER COLUMN "supplier_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "supplier_quotes_supplier_id_idx" ON "supplier_quotes"("supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_cnpj_digits CHECK (cnpj ~ '^[0-9]{14}$'),
  ADD CONSTRAINT suppliers_company_name CHECK (btrim(company_name) <> '' AND length(company_name) <= 160),
  ADD CONSTRAINT suppliers_state CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT suppliers_lengths CHECK (
    coalesce(length(trade_name), 0) <= 160 AND coalesce(length(contact_name), 0) <= 120
    AND coalesce(length(phone), 0) <= 30 AND coalesce(length(whatsapp), 0) <= 30 AND coalesce(length(email), 0) <= 160
    AND coalesce(length(city), 0) <= 120 AND coalesce(length(region), 0) <= 300
    AND coalesce(length(specialty), 0) <= 300 AND coalesce(length(team), 0) <= 1000
    AND coalesce(length(equipment), 0) <= 1000 AND coalesce(length(capacity), 0) <= 1000
    AND coalesce(length(notes), 0) <= 2000);

ALTER TABLE supplier_bonuses
  ADD CONSTRAINT supplier_bonuses_value CHECK (value >= 0 AND (kind <> 'PERCENTUAL' OR value <= 100)),
  ADD CONSTRAINT supplier_bonuses_notes CHECK (coalesce(length(notes), 0) <= 500);

-- ─────────────────────────────── Quem é quem ───────────────────────────────

-- Participação ativa da pessoa logada em algum evento aberto da agência, com um destes papéis.
CREATE FUNCTION app.agency_role_in(p_agency uuid, p_roles participant_role[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM participants p
      JOIN users u    ON u.id = p.user_id
      JOIN events e   ON e.id = p.event_id
      JOIN agencies g ON g.id = e.agency_id
     WHERE p.user_id = app.current_user_id()
       AND e.agency_id = p_agency
       AND p.role = ANY (p_roles)
       AND p.active AND p.deleted_at IS NULL
       AND u.active AND e.deleted_at IS NULL
       AND g.status = 'ACTIVE'
  )
$$;
REVOKE ALL ON FUNCTION app.agency_role_in(uuid, participant_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.agency_role_in(uuid, participant_role[]) TO core_app;

-- Ver o cadastro: Admin ou Suporte da agência, Gerente ou Pré-produtor de um evento dela.
CREATE FUNCTION app.can_see_suppliers(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_agency_admin(p_agency) OR app.agency_role_in(p_agency, ARRAY['GERENTE', 'PRE_PRODUTOR']::participant_role[])
$$;

-- Cadastrar e editar: o mesmo, menos o Suporte (que só olha).
CREATE FUNCTION app.can_edit_suppliers(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_agency_full_admin(p_agency) OR app.agency_role_in(p_agency, ARRAY['GERENTE', 'PRE_PRODUTOR']::participant_role[])
$$;

-- Diretor de produção da agência: o Admin dela ou o Gerente de um evento dela.
CREATE FUNCTION app.is_agency_director(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_agency_full_admin(p_agency) OR app.agency_role_in(p_agency, ARRAY['GERENTE']::participant_role[])
$$;

-- O fornecedor foi escolhido numa cotação de um item da área de que a pessoa é Head.
CREATE FUNCTION app.supplier_in_my_area(p_supplier uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM supplier_quotes sq
      JOIN quote_requests qr ON qr.id = sq.request_id AND qr.chosen_quote_id = sq.id AND qr.status = 'FECHADA'
      JOIN cost_items ci     ON ci.id = qr.cost_item_id AND ci.area_id IS NOT NULL
      CROSS JOIN LATERAL app.membership(ci.event_id) m
     WHERE sq.supplier_id = p_supplier
       AND m.role = 'HEAD' AND m.area_id = ci.area_id
  )
$$;
REVOKE ALL ON FUNCTION app.supplier_in_my_area(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supplier_in_my_area(uuid) TO core_app;

-- A agência do fornecedor, para as regras da bonificação (que não tem a coluna).
CREATE FUNCTION app.supplier_agency(p_supplier uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT agency_id FROM suppliers WHERE id = p_supplier
$$;
REVOKE ALL ON FUNCTION app.supplier_agency(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supplier_agency(uuid) TO core_app;

-- ─────────────────────────────── Gatilhos ───────────────────────────────

-- A agência e o CNPJ não mudam. Arquivar ou reativar: só o diretor.
CREATE FUNCTION suppliers_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.agency_id <> OLD.agency_id OR NEW.cnpj <> OLD.cnpj OR NEW.created_by <> OLD.created_by) THEN
    RAISE EXCEPTION 'a agência e o CNPJ do fornecedor não mudam' USING ERRCODE = 'check_violation';
  END IF;
  IF current_user = 'core_app' AND (NEW.archived_at IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.archived_at END))
     AND NOT app.is_agency_director(NEW.agency_id) THEN
    RAISE EXCEPTION 'só o diretor arquiva ou reativa um fornecedor' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION suppliers_guard() FROM PUBLIC;
CREATE TRIGGER suppliers_guard
  BEFORE INSERT OR UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION suppliers_guard();

-- O orçamento só aponta para fornecedor da mesma agência do evento, com o mesmo
-- CNPJ, e não para um arquivado (novo orçamento ou troca de fornecedor).
CREATE FUNCTION supplier_quotes_supplier_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s suppliers%ROWTYPE;
BEGIN
  SELECT * INTO s FROM suppliers WHERE id = NEW.supplier_id;
  IF s.agency_id IS DISTINCT FROM (SELECT agency_id FROM events WHERE id = NEW.event_id) OR s.cnpj <> NEW.cnpj THEN
    RAISE EXCEPTION 'o orçamento precisa ser de um fornecedor do cadastro da agência, com o mesmo CNPJ' USING ERRCODE = 'check_violation';
  END IF;
  IF s.archived_at IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.supplier_id <> OLD.supplier_id) THEN
    RAISE EXCEPTION 'fornecedor arquivado; peça ao diretor para reativar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION supplier_quotes_supplier_check() FROM PUBLIC;
CREATE TRIGGER supplier_quotes_supplier_check
  BEFORE INSERT OR UPDATE OF supplier_id, cnpj, event_id ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION supplier_quotes_supplier_check();

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON suppliers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON suppliers TO core_app;

-- Nunca é apagado (não há regra de DELETE): só arquivado.
CREATE POLICY app_select ON suppliers FOR SELECT TO core_app
  USING (app.can_see_suppliers(agency_id) OR app.supplier_in_my_area(id));
CREATE POLICY app_insert ON suppliers FOR INSERT TO core_app
  WITH CHECK (app.can_edit_suppliers(agency_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON suppliers FOR UPDATE TO core_app
  USING (app.can_edit_suppliers(agency_id))
  WITH CHECK (app.can_edit_suppliers(agency_id));

ALTER TABLE supplier_bonuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_bonuses FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_bonuses TO core_app;

-- Vê: o diretor (e o Suporte da agência) e o Head da área em que o fornecedor
-- foi contratado. O Pré-produtor, o campo e o cliente não veem. Preenche: só o diretor.
CREATE POLICY app_select ON supplier_bonuses FOR SELECT TO core_app
  USING (app.is_agency_admin(app.supplier_agency(supplier_id)) OR app.is_agency_director(app.supplier_agency(supplier_id))
         OR app.supplier_in_my_area(supplier_id));
CREATE POLICY app_insert ON supplier_bonuses FOR INSERT TO core_app
  WITH CHECK (app.is_agency_director(app.supplier_agency(supplier_id)) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON supplier_bonuses FOR UPDATE TO core_app
  USING (app.is_agency_director(app.supplier_agency(supplier_id)))
  WITH CHECK (app.is_agency_director(app.supplier_agency(supplier_id)) AND updated_by = app.current_user_id());
CREATE POLICY app_delete ON supplier_bonuses FOR DELETE TO core_app
  USING (app.is_agency_director(app.supplier_agency(supplier_id)));

-- Fornecedores contratados no evento (escolhidos numa cotação de um item), sem
-- valores, para o campo: o gestor vê todos; o Head, os dos itens da área dele.
CREATE FUNCTION app.event_contracted_suppliers(p_event uuid)
RETURNS TABLE (supplier_id uuid, item_id uuid, item_name text, item_number integer, item_category item_category, area_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sq.supplier_id, ci.id, ci.name, ci.number, ci.category, ci.area_id
    FROM quote_requests qr
    JOIN supplier_quotes sq ON sq.id = qr.chosen_quote_id
    JOIN cost_items ci      ON ci.id = qr.cost_item_id
   WHERE qr.event_id = p_event AND qr.status = 'FECHADA'
     AND (app.can_review_sla(p_event)
          OR EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'HEAD' AND m.area_id = ci.area_id))
   ORDER BY ci.number
$$;
REVOKE ALL ON FUNCTION app.event_contracted_suppliers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_contracted_suppliers(uuid) TO core_app;
