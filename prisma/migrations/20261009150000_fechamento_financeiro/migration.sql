-- AlterTable
ALTER TABLE "cost_items" ADD COLUMN     "invoice_number" TEXT,
ADD COLUMN     "overrun_reason" TEXT,
ADD COLUMN     "paid_on" DATE;

-- AlterTable
ALTER TABLE "event_finances" ADD COLUMN     "financial_closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "financial_closed_by" UUID;

-- AddForeignKey
ALTER TABLE "event_finances" ADD CONSTRAINT "event_finances_financial_closed_by_fkey" FOREIGN KEY ("financial_closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─────────────────────── Fase 7B: fechamento financeiro ───────────────────────
-- O produtor executivo (Gerente do evento) e o diretor (Admin de verdade da
-- agência, ou Gerente; o Suporte não) marcam o pagamento de cada item e,
-- no Fechamento, fecham o financeiro. Fechado, os valores do evento travam;
-- reabrir pede um motivo (fica na auditoria). O evento só vai para Concluído
-- com o financeiro fechado (quando tem algum valor contratado ou realizado).

ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_invoice_number_len CHECK (invoice_number IS NULL OR length(invoice_number) BETWEEN 1 AND 60),
  ADD CONSTRAINT cost_items_overrun_reason_len CHECK (overrun_reason IS NULL OR length(overrun_reason) BETWEEN 1 AND 500);

CREATE FUNCTION app.financial_closed(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM event_finances WHERE event_id = p_event AND financial_closed_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION app.financial_closed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.financial_closed(uuid) TO core_app;

-- Itens que entram no fechamento: os não opcionais com contratado ou realizado.
CREATE FUNCTION app.financial_needed(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM cost_items
     WHERE event_id = p_event AND NOT optional AND (contracted_value IS NOT NULL OR actual_value IS NOT NULL)
  )
$$;
REVOKE ALL ON FUNCTION app.financial_needed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.financial_needed(uuid) TO core_app;

-- Quantos desses itens ainda impedem o fechamento: sem realizado, sem
-- pagamento, ou com estouro sem motivo.
CREATE FUNCTION app.financial_pending(p_event uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer FROM cost_items
   WHERE event_id = p_event AND NOT optional AND (contracted_value IS NOT NULL OR actual_value IS NOT NULL)
     AND (actual_value IS NULL OR paid_on IS NULL
          OR (contracted_value IS NOT NULL AND actual_value > contracted_value AND overrun_reason IS NULL))
$$;
REVOKE ALL ON FUNCTION app.financial_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.financial_pending(uuid) TO core_app;

-- Itens: pagamento só pelo executivo/diretor; financeiro fechado, os valores
-- não mudam e não entra nem sai item.
CREATE FUNCTION cost_items_finance_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_event uuid := COALESCE(NEW.event_id, OLD.event_id);
BEGIN
  IF current_user <> 'core_app' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF app.financial_closed(v_event) THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'O financeiro do evento está fechado: reabra para incluir ou apagar itens' USING ERRCODE = '23514';
    END IF;
    IF (NEW.unit_value, NEW.quantity, NEW.frequency, NEW.optional, NEW.billing, NEW.cost_center, NEW.quoted_value,
        NEW.contracted_value, NEW.actual_value, NEW.paid_on, NEW.invoice_number, NEW.overrun_reason)
       IS DISTINCT FROM
       (OLD.unit_value, OLD.quantity, OLD.frequency, OLD.optional, OLD.billing, OLD.cost_center, OLD.quoted_value,
        OLD.contracted_value, OLD.actual_value, OLD.paid_on, OLD.invoice_number, OLD.overrun_reason) THEN
      RAISE EXCEPTION 'O financeiro do evento está fechado: reabra para mudar os valores' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (TG_OP = 'INSERT' AND (NEW.paid_on IS NOT NULL OR NEW.invoice_number IS NOT NULL OR NEW.overrun_reason IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.paid_on, NEW.invoice_number, NEW.overrun_reason) IS DISTINCT FROM (OLD.paid_on, OLD.invoice_number, OLD.overrun_reason)) THEN
    IF NOT app.can_close_event(NEW.event_id) THEN
      RAISE EXCEPTION 'Só o produtor executivo e o diretor marcam o pagamento' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cost_items_finance_lock BEFORE INSERT OR UPDATE OR DELETE ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_finance_lock();

-- Apagar a seção apaga os itens em cascata (a cascata roda como dono da
-- tabela, sem passar pela trava acima): fechado, seção com item não sai.
CREATE FUNCTION cost_sections_finance_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'core_app' AND app.financial_closed(OLD.event_id)
     AND EXISTS (SELECT 1 FROM cost_items WHERE section_id = OLD.id) THEN
    RAISE EXCEPTION 'O financeiro do evento está fechado: reabra para apagar itens' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER cost_sections_finance_lock BEFORE DELETE ON cost_sections
  FOR EACH ROW EXECUTE FUNCTION cost_sections_finance_lock();

-- Fechar e reabrir: só o executivo/diretor; fechar só no Fechamento e com
-- tudo pago; reabrir não pode com o evento Concluído. Fechado, o orçamento
-- aprovado e o centro de custo também não mudam.
CREATE FUNCTION event_finances_close_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_status event_status;
  v_was_closed boolean := TG_OP = 'UPDATE' AND OLD.financial_closed_at IS NOT NULL;
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF v_was_closed AND NEW.financial_closed_at IS NOT NULL
     AND (NEW.approved_budget, NEW.cost_center) IS DISTINCT FROM (OLD.approved_budget, OLD.cost_center) THEN
    RAISE EXCEPTION 'O financeiro do evento está fechado: reabra para mudar os valores' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.financial_closed_at IS NULL AND NEW.financial_closed_by IS NULL)
     OR (TG_OP = 'UPDATE' AND (NEW.financial_closed_at, NEW.financial_closed_by) IS NOT DISTINCT FROM (OLD.financial_closed_at, OLD.financial_closed_by)) THEN
    RETURN NEW; -- não abriu nem fechou
  END IF;
  IF NOT app.can_close_event(NEW.event_id) THEN
    RAISE EXCEPTION 'Só o produtor executivo e o diretor fecham o financeiro' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM events WHERE id = NEW.event_id;
  IF NEW.financial_closed_at IS NOT NULL THEN
    IF v_was_closed THEN
      RAISE EXCEPTION 'O financeiro já está fechado' USING ERRCODE = '23514';
    END IF;
    IF NEW.financial_closed_by IS DISTINCT FROM app.current_user_id() THEN
      RAISE EXCEPTION 'O fechamento fica no nome de quem fechou' USING ERRCODE = '42501';
    END IF;
    IF v_status <> 'FECHAMENTO' THEN
      RAISE EXCEPTION 'O financeiro fecha com o evento na etapa Fechamento' USING ERRCODE = '23514';
    END IF;
    IF app.financial_pending(NEW.event_id) > 0 THEN
      RAISE EXCEPTION 'Ainda há itens sem realizado, sem pagamento ou com estouro sem motivo' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.financial_closed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Reabrir limpa quem fechou' USING ERRCODE = '23514';
    END IF;
    IF v_status = 'CONCLUIDO' THEN
      RAISE EXCEPTION 'Volte o evento para Fechamento antes de reabrir o financeiro' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_finances_close_guard BEFORE INSERT OR UPDATE ON event_finances
  FOR EACH ROW EXECUTE FUNCTION event_finances_close_guard();

-- Concluído só com o financeiro fechado (eventos sem nenhum valor passam).
CREATE FUNCTION events_conclude_needs_financial() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'core_app' AND NEW.status = 'CONCLUIDO' AND OLD.status <> 'CONCLUIDO'
     AND app.financial_needed(NEW.id) AND NOT app.financial_closed(NEW.id) THEN
    RAISE EXCEPTION 'Feche o financeiro antes de concluir o evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_conclude_needs_financial BEFORE UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION events_conclude_needs_financial();
