-- Fase 2B do roadmap (Abu, 2026-10-08): o Orçamento com os 4 valores do item.
-- Estimado é o valor da planilha Padrão CORE 360 (unitário × quantidade ×
-- frequência). Cotado vem sozinho do menor orçamento da cotação; sem cotação,
-- pode ser digitado. Contratado (a escolha do diretor na cotação, ou digitado)
-- e Realizado são só do diretor de produção, também aqui no banco.
-- Preencher o Contratado põe o item em Contratado.

ALTER TABLE "cost_items" ADD COLUMN "quoted_value" DECIMAL(14,2),
ADD COLUMN "contracted_value" DECIMAL(14,2),
ADD COLUMN "actual_value" DECIMAL(14,2);

ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_quoted_value_nonneg CHECK (quoted_value IS NULL OR quoted_value >= 0),
  ADD CONSTRAINT cost_items_contracted_value_nonneg CHECK (contracted_value IS NULL OR contracted_value >= 0),
  ADD CONSTRAINT cost_items_actual_value_nonneg CHECK (actual_value IS NULL OR actual_value >= 0);

-- Mesmo gatilho da fase 2A, agora também com Contratado e Realizado.
CREATE OR REPLACE FUNCTION cost_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_restricted item_status[] := ARRAY['APROVADO', 'CONTRATADO', 'NO_LOCAL', 'MONTADO', 'CONFERIDO', 'FINALIZADO']::item_status[];
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.number := OLD.number; END IF;
  IF current_user <> 'core_app' OR app.can_review_sla(NEW.event_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_center IS NOT NULL OR NEW.status = ANY (v_restricted)
       OR NEW.contracted_value IS NOT NULL OR NEW.actual_value IS NOT NULL THEN
      RAISE EXCEPTION 'só o diretor de produção define este status, o centro de custo, o contratado ou o realizado' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.cost_center IS DISTINCT FROM OLD.cost_center THEN
    RAISE EXCEPTION 'só o diretor de produção muda o centro de custo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.contracted_value IS DISTINCT FROM OLD.contracted_value OR NEW.actual_value IS DISTINCT FROM OLD.actual_value THEN
    RAISE EXCEPTION 'só o diretor de produção muda o contratado e o realizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> OLD.status AND (
       NEW.status = ANY (v_restricted)
       OR OLD.status >= 'NO_LOCAL'
       OR (OLD.status IN ('APROVADO', 'CONTRATADO') AND NEW.status < 'APROVADO')
     ) THEN
    RAISE EXCEPTION 'só o diretor de produção muda o item para ou deste status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Contratado preenchido → o item vai para Contratado (só avança). Roda depois
-- do cost_items_guard (ordem alfabética), que já conferiu quem preencheu.
CREATE FUNCTION cost_items_status_from_values() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.contracted_value IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.contracted_value IS NULL)
     AND NEW.status < 'CONTRATADO' THEN
    NEW.status := 'CONTRATADO';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cost_items_status_from_values
  BEFORE INSERT OR UPDATE OF contracted_value ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_status_from_values();

-- Itens que já tinham um orçamento escolhido: o valor dele vira o Contratado.
UPDATE cost_items i SET contracted_value = q.total_value
  FROM quote_requests r JOIN supplier_quotes q ON q.id = r.chosen_quote_id
 WHERE r.cost_item_id = i.id AND r.status = 'FECHADA' AND i.contracted_value IS NULL;
