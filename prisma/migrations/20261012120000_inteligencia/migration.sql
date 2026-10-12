-- Fase 7C: inteligência da agência. Ranking de fornecedores, banco de preços
-- e comparativo entre eventos. Os preços dos outros eventos ficam fora da RLS
-- de cada evento, então saem só por estas funções, e só para o diretor: o
-- Admin (ou o Suporte) da agência e quem é Gerente de um evento dela.

CREATE FUNCTION app.can_see_agency_prices(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_agency_admin(p_agency) OR app.agency_role_in(p_agency, ARRAY['GERENTE']::participant_role[])
$$;
REVOKE ALL ON FUNCTION app.can_see_agency_prices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_see_agency_prices(uuid) TO core_app;

-- Os eventos da agência (menos os cancelados), com o público previsto e se já
-- foram encerrados e excluídos (desses, os itens vêm do resumo guardado).
CREATE FUNCTION app.agency_events_overview(p_agency uuid)
RETURNS TABLE (
  event_id uuid, number integer, name text, client_name text, starts_at timestamptz, ends_at timestamptz,
  timezone text, status text, audience integer, archived boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.number, e.name, c.name, e.starts_at, e.ends_at, e.timezone, e.status::text, e.expected_audience,
         (a.closed_at IS NOT NULL)
    FROM events e
    JOIN clients c ON c.id = e.client_id
    LEFT JOIN event_archives a ON a.event_id = e.id
   WHERE e.agency_id = p_agency AND e.deleted_at IS NULL AND e.status <> 'CANCELADO'
     AND app.can_see_agency_prices(p_agency)
$$;
REVOKE ALL ON FUNCTION app.agency_events_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.agency_events_overview(uuid) TO core_app;

-- Os itens dos eventos ainda guardados no app, com os 4 valores crus (o app
-- faz as contas como no Orçamento) e o fornecedor escolhido na cotação.
CREATE FUNCTION app.agency_cost_items(p_agency uuid)
RETURNS TABLE (
  event_id uuid, item_number integer, name text, category text, quantity numeric, unit text,
  frequency numeric, unit_value numeric, optional boolean, quoted_value numeric, lowest_quote numeric,
  contracted_value numeric, actual_value numeric, supplier text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ci.event_id, ci.number, ci.name, ci.category::text, ci.quantity, ci.unit, ci.frequency, ci.unit_value,
         ci.optional, ci.quoted_value,
         (SELECT min(coalesce(sq.negotiated_value, sq.total_value))
            FROM quote_requests qr
            JOIN supplier_quotes sq ON sq.request_id = qr.id
           WHERE qr.cost_item_id = ci.id AND qr.status <> 'CANCELADA'
             AND sq.status <> 'CANCELADA' AND sq.total_value IS NOT NULL),
         ci.contracted_value, ci.actual_value,
         (SELECT coalesce(nullif(s.trade_name, ''), nullif(s.company_name, ''), sq.company_name)
            FROM quote_requests qr
            JOIN supplier_quotes sq ON sq.id = qr.chosen_quote_id
            JOIN suppliers s ON s.id = sq.supplier_id
           WHERE qr.cost_item_id = ci.id AND qr.status = 'FECHADA'
           ORDER BY qr.closed_at DESC NULLS LAST
           LIMIT 1)
    FROM cost_items ci
    JOIN events e ON e.id = ci.event_id
   WHERE e.agency_id = p_agency AND e.deleted_at IS NULL AND e.status <> 'CANCELADO'
     AND app.can_see_agency_prices(p_agency)
$$;
REVOKE ALL ON FUNCTION app.agency_cost_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.agency_cost_items(uuid) TO core_app;
