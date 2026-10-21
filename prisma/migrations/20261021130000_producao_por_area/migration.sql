-- ═══════════════════ Pré-produção separada por área (Abu, 2026-10-21) ═══════════════════
-- O Pré-produtor ligado a uma área trabalha só a pré-produção dela: itens e
-- cotações da área; chegadas e pendências da área ou do evento todo (sem
-- área). Sem área, ele continua vendo o evento inteiro. O Gerente de produção,
-- o diretor e o Produtor executivo não mudam. São políticas RESTRICTIVE: valem
-- por cima das que já existem. Espelha productionArea em src/server/authz/policy.ts.

-- A área de pré-produção da pessoa logada neste evento (NULL: o evento todo).
CREATE FUNCTION app.production_area(p_event uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN app.is_event_admin(p_event) THEN NULL ELSE (
    SELECT m.area_id FROM app.membership(p_event) m WHERE m.role = 'PRE_PRODUTOR' LIMIT 1
  ) END
$$;

-- Esta linha (de uma área, ou sem área) está na pré-produção da pessoa?
CREATE FUNCTION app.in_production_area(p_event uuid, p_area uuid, p_event_wide_ok boolean) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN app.production_area(p_event) IS NULL THEN true
    WHEN p_area IS NULL THEN p_event_wide_ok
    ELSE p_area = app.production_area(p_event)
  END
$$;

-- A área do item da planilha (para a cotação).
CREATE FUNCTION app.cost_item_area(p_item uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT area_id FROM cost_items WHERE id = p_item
$$;

REVOKE ALL ON FUNCTION app.production_area(uuid), app.in_production_area(uuid, uuid, boolean), app.cost_item_area(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.production_area(uuid), app.in_production_area(uuid, uuid, boolean), app.cost_item_area(uuid)
  TO core_app, core_worker;

CREATE POLICY app_production_area ON cost_items AS RESTRICTIVE FOR ALL TO core_app
  USING (app.in_production_area(event_id, area_id, false))
  WITH CHECK (app.in_production_area(event_id, area_id, false));

CREATE POLICY app_production_area ON quote_requests AS RESTRICTIVE FOR ALL TO core_app
  USING (app.in_production_area(event_id, app.cost_item_area(cost_item_id), false))
  WITH CHECK (app.in_production_area(event_id, app.cost_item_area(cost_item_id), false));

CREATE POLICY app_production_area ON arrivals AS RESTRICTIVE FOR ALL TO core_app
  USING (app.in_production_area(event_id, area_id, true))
  WITH CHECK (app.in_production_area(event_id, area_id, true));

CREATE POLICY app_production_area ON event_tasks AS RESTRICTIVE FOR ALL TO core_app
  USING (app.in_production_area(event_id, area_id, true))
  WITH CHECK (app.in_production_area(event_id, area_id, true));
