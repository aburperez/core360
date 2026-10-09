-- DropIndex
DROP INDEX "supplier_ratings_event_id_supplier_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ratings_event_id_supplier_id_rated_by_key" ON "supplier_ratings"("event_id", "supplier_id", "rated_by");


-- ──────────────── O Head da área também avalia (pedido do Abu) ────────────────
-- Cada pessoa dá a sua nota (uma por fornecedor no evento). Avaliam: o diretor
-- (Gerente do evento ou Admin da agência, sem o Suporte) e o Head da área que
-- tem item contratado pelo fornecedor num contrato assinado.

-- Fornecedor com contrato assinado no evento (o Head não lê contratos).
CREATE FUNCTION app.supplier_signed_in_event(p_event uuid, p_supplier uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM contracts WHERE event_id = p_event AND supplier_id = p_supplier AND status = 'ASSINADO')
$$;
REVOKE ALL ON FUNCTION app.supplier_signed_in_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supplier_signed_in_event(uuid, uuid) TO core_app;

-- Quem pode avaliar este fornecedor neste evento.
CREATE FUNCTION app.can_rate_supplier(p_event uuid, p_supplier uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (app.can_review_sla(p_event) AND app.is_agency_director((SELECT agency_id FROM events WHERE id = p_event)))
      OR EXISTS (
        SELECT 1
          FROM contracts c
          JOIN contract_items ci  ON ci.contract_id = c.id
          JOIN supplier_quotes sq ON sq.id = ci.quote_id
          JOIN quote_requests qr  ON qr.id = sq.request_id
          JOIN cost_items it      ON it.id = qr.cost_item_id AND it.area_id IS NOT NULL
          CROSS JOIN LATERAL app.membership(p_event) m
         WHERE c.event_id = p_event AND c.supplier_id = p_supplier AND c.status = 'ASSINADO'
           AND m.role = 'HEAD' AND m.area_id = it.area_id
      )
$$;
REVOKE ALL ON FUNCTION app.can_rate_supplier(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_rate_supplier(uuid, uuid) TO core_app;

CREATE OR REPLACE FUNCTION supplier_ratings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e events%ROWTYPE;
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.event_id <> OLD.event_id OR NEW.supplier_id <> OLD.supplier_id) THEN
    RAISE EXCEPTION 'Evento e fornecedor da avaliação não mudam' USING ERRCODE = '23514';
  END IF;
  IF NEW.rated_by IS DISTINCT FROM app.current_user_id() OR (TG_OP = 'UPDATE' AND OLD.rated_by <> NEW.rated_by) THEN
    RAISE EXCEPTION 'A avaliação fica no nome de quem avaliou' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM events WHERE id = NEW.event_id;
  IF e.deleted_at IS NOT NULL OR e.status NOT IN ('FECHAMENTO', 'CONCLUIDO') THEN
    RAISE EXCEPTION 'A avaliação abre quando o evento chega no Fechamento' USING ERRCODE = '23514';
  END IF;
  IF NOT app.supplier_signed_in_event(NEW.event_id, NEW.supplier_id) THEN
    RAISE EXCEPTION 'Só fornecedor com contrato assinado no evento é avaliado' USING ERRCODE = '23514';
  END IF;
  IF NOT app.can_rate_supplier(NEW.event_id, NEW.supplier_id) THEN
    RAISE EXCEPTION 'Só o diretor e o Head da área avaliam o fornecedor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- O diretor e o Suporte veem todas as notas; quem avaliou vê a sua.
DROP POLICY app_select ON supplier_ratings;
DROP POLICY app_insert ON supplier_ratings;
DROP POLICY app_update ON supplier_ratings;
CREATE POLICY app_select ON supplier_ratings FOR SELECT TO core_app
  USING (app.is_agency_admin(app.supplier_agency(supplier_id)) OR app.is_agency_director(app.supplier_agency(supplier_id))
         OR rated_by = app.current_user_id());
CREATE POLICY app_insert ON supplier_ratings FOR INSERT TO core_app
  WITH CHECK (app.can_rate_supplier(event_id, supplier_id) AND rated_by = app.current_user_id());
CREATE POLICY app_update ON supplier_ratings FOR UPDATE TO core_app
  USING (rated_by = app.current_user_id() AND app.can_rate_supplier(event_id, supplier_id))
  WITH CHECK (rated_by = app.current_user_id() AND app.can_rate_supplier(event_id, supplier_id));

-- A média junta as notas de todos; "ratings" conta os eventos avaliados.
CREATE OR REPLACE FUNCTION app.supplier_rating_summary(p_agency uuid)
RETURNS TABLE (
  supplier_id uuid, ratings integer, overall numeric, quality numeric, deadline numeric, service numeric,
  cost numeric, flexibility numeric, problem_solving numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.supplier_id, count(DISTINCT r.event_id)::integer,
         round(avg((r.quality + r.deadline + r.service + r.cost + r.flexibility + r.problem_solving) / 6.0), 1),
         round(avg(r.quality), 1), round(avg(r.deadline), 1), round(avg(r.service), 1),
         round(avg(r.cost), 1), round(avg(r.flexibility), 1), round(avg(r.problem_solving), 1)
    FROM supplier_ratings r
    JOIN suppliers s ON s.id = r.supplier_id
    JOIN events e ON e.id = r.event_id
   WHERE s.agency_id = p_agency AND e.deleted_at IS NULL
     AND app.can_see_suppliers(p_agency)
   GROUP BY r.supplier_id
$$;
