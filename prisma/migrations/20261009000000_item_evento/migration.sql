-- Fase 2A do roadmap (Abu, 2026-10-08): a linha da planilha de custos vira o
-- Item do evento. Ganha número (código EVT001-CEN-023), área, categoria,
-- centro de custo, unidade, responsável, data de necessidade, local, status e
-- observação. Os status mudam sozinhos com a cotação e com a conferência no
-- campo. Centro de custo e os status do diretor e do campo só o diretor de
-- produção (Gerente do evento ou Admin da agência) muda, também aqui no banco.
-- Na equipe, cada pessoa ganha empresa e responsável direto.

CREATE TYPE "item_status" AS ENUM ('A_DEFINIR', 'EM_COTACAO', 'COTACAO_RECEBIDA', 'EM_APROVACAO', 'APROVADO', 'CONTRATADO', 'EM_PRODUCAO', 'PRONTO', 'EM_TRANSPORTE', 'NO_LOCAL', 'MONTADO', 'CONFERIDO', 'FINALIZADO');
CREATE TYPE "item_category" AS ENUM ('INFRAESTRUTURA', 'CENOGRAFIA', 'TECNICA', 'AUDIOVISUAL', 'ILUMINACAO', 'MOBILIARIO', 'COMUNICACAO_VISUAL', 'RECURSOS_HUMANOS', 'SEGURANCA', 'LIMPEZA', 'TRANSPORTE', 'HOSPEDAGEM', 'ALIMENTACAO', 'LOGISTICA', 'LOCACAO', 'TAXAS', 'PRODUCAO', 'CONTINGENCIA');
CREATE TYPE "cost_center" AS ENUM ('INFRA', 'CENO', 'TECNICA', 'OPERACAO', 'LOGISTICA', 'STAFF', 'PRODUCAO', 'ADMINISTRATIVO');

ALTER TABLE "agencies" ADD COLUMN "event_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "events" ADD COLUMN "item_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cost_items" ADD COLUMN "area_id" UUID,
ADD COLUMN "category" "item_category",
ADD COLUMN "cost_center" "cost_center",
ADD COLUMN "location" TEXT,
ADD COLUMN "needed_on" DATE,
ADD COLUMN "notes" TEXT,
ADD COLUMN "number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "responsible_id" UUID,
ADD COLUMN "status" "item_status" NOT NULL DEFAULT 'A_DEFINIR',
ADD COLUMN "unit" TEXT;
ALTER TABLE "item_receipts" ADD COLUMN "location" TEXT,
ADD COLUMN "unit" TEXT;
ALTER TABLE "participants" ADD COLUMN "company" TEXT,
ADD COLUMN "direct_manager" TEXT;

-- ───────────────────────────── Números ─────────────────────────────

-- Eventos que já existem: número na ordem em que foram criados, por agência.
WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY agency_id ORDER BY created_at, id) AS rn FROM events
)
UPDATE events e SET number = n.rn FROM n WHERE n.id = e.id;
UPDATE agencies a SET event_seq = COALESCE((SELECT max(number) FROM events e WHERE e.agency_id = a.id), 0);

-- Itens que já existem: número na ordem da planilha (seção, depois item).
WITH n AS (
  SELECT i.id, row_number() OVER (PARTITION BY i.event_id ORDER BY s.position, s.created_at, i.position, i.created_at, i.id) AS rn
    FROM cost_items i JOIN cost_sections s ON s.id = i.section_id
)
UPDATE cost_items i SET number = n.rn FROM n WHERE n.id = i.id;
UPDATE events e SET item_seq = COALESCE((SELECT max(number) FROM cost_items i WHERE i.event_id = e.id), 0);

CREATE UNIQUE INDEX "events_agency_id_number_key" ON "events"("agency_id", "number");
CREATE UNIQUE INDEX "cost_items_event_id_number_key" ON "cost_items"("event_id", "number");
CREATE INDEX "cost_items_event_id_status_idx" ON "cost_items"("event_id", "status");

ALTER TABLE events ADD CONSTRAINT events_item_seq_non_negative CHECK (item_seq >= 0);
ALTER TABLE agencies ADD CONSTRAINT agencies_event_seq_non_negative CHECK (event_seq >= 0);

-- Novo evento: próximo número da agência. SECURITY DEFINER: quem cria o evento não muda "agencies".
CREATE FUNCTION events_number_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE agencies SET event_seq = event_seq + 1 WHERE id = NEW.agency_id RETURNING event_seq INTO NEW.number;
  IF NEW.number IS NULL THEN
    RAISE EXCEPTION 'agência % não existe', NEW.agency_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.item_seq := 0;
  RETURN NEW;
END $$;
CREATE TRIGGER events_number_before_insert
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_number_before_insert();

-- Número e contadores não mudam por fora (o contador só pelo gatilho dos itens).
CREATE FUNCTION events_number_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.number := OLD.number;
  IF current_user = 'core_app' THEN NEW.item_seq := OLD.item_seq; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_number_frozen
  BEFORE UPDATE OF number, item_seq ON events
  FOR EACH ROW EXECUTE FUNCTION events_number_frozen();

-- Novo item: próximo número do evento. SECURITY DEFINER: a Pré-produção não muda "events" por aqui.
CREATE FUNCTION cost_items_number_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE events SET item_seq = item_seq + 1 WHERE id = NEW.event_id RETURNING item_seq INTO NEW.number;
  IF NEW.number IS NULL THEN
    RAISE EXCEPTION 'evento % não existe', NEW.event_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cost_items_number_before_insert
  BEFORE INSERT ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_number_before_insert();

-- ───────────────────────────── Categoria ─────────────────────────────

-- Categoria deduzida pelo nome da seção da planilha, quando bate.
CREATE FUNCTION app.guess_item_category(p_name text) RETURNS item_category
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n LIKE '%infra%' OR n LIKE '%estrutura%' OR n LIKE '%energia%' OR n LIKE '%gerador%' THEN 'INFRAESTRUTURA'
    WHEN n LIKE '%cenograf%' THEN 'CENOGRAFIA'
    WHEN n LIKE '%comunicacao%' THEN 'COMUNICACAO_VISUAL'
    WHEN n LIKE '%ilumina%' THEN 'ILUMINACAO'
    WHEN n LIKE '%audiovisual%' THEN 'AUDIOVISUAL'
    WHEN n LIKE '%tecnic%' THEN 'TECNICA'
    WHEN n LIKE '%mobiliar%' THEN 'MOBILIARIO'
    WHEN n LIKE '%recursos humanos%' OR n LIKE '%equipe%' OR n LIKE '%staff%' THEN 'RECURSOS_HUMANOS'
    WHEN n LIKE '%seguranca%' THEN 'SEGURANCA'
    WHEN n LIKE '%limpeza%' THEN 'LIMPEZA'
    WHEN n LIKE '%transporte%' THEN 'TRANSPORTE'
    WHEN n LIKE '%hospedag%' OR n LIKE '%hotel%' THEN 'HOSPEDAGEM'
    WHEN n LIKE '%a&b%' OR n LIKE '%aliment%' OR n LIKE '%catering%' OR n LIKE '%buffet%' THEN 'ALIMENTACAO'
    WHEN n LIKE '%logistic%' OR n LIKE '%frete%' THEN 'LOGISTICA'
    WHEN n LIKE '%locacao%' THEN 'LOCACAO'
    WHEN n LIKE '%taxa%' THEN 'TAXAS'
    WHEN n LIKE '%producao%' THEN 'PRODUCAO'
    WHEN n LIKE '%conting%' THEN 'CONTINGENCIA'
  END::item_category
  FROM (SELECT translate(lower(coalesce(p_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') AS n) x
$$;
REVOKE ALL ON FUNCTION app.guess_item_category(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guess_item_category(text) TO core_app;

UPDATE cost_items i SET category = app.guess_item_category(s.name)
  FROM cost_sections s WHERE s.id = i.section_id;

-- Item novo sem categoria: tenta pela seção (vale também para a planilha importada).
CREATE FUNCTION cost_items_default_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := app.guess_item_category((SELECT name FROM cost_sections WHERE id = NEW.section_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cost_items_default_category
  BEFORE INSERT ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_default_category();

-- ─────────────────────── Quem muda o quê no item ───────────────────────

-- O número não muda. Pela aplicação (core_app), quem não é diretor:
--  - não escolhe o centro de custo;
--  - não põe o item em Aprovado, Contratado, nos status do campo nem em Finalizado;
--  - não tira o item dos status do campo ou de Finalizado;
--  - não volta um item Aprovado ou Contratado para antes da aprovação.
-- Os gatilhos da cotação e do campo (SECURITY DEFINER) rodam como dono e passam.
CREATE FUNCTION cost_items_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_restricted item_status[] := ARRAY['APROVADO', 'CONTRATADO', 'NO_LOCAL', 'MONTADO', 'CONFERIDO', 'FINALIZADO']::item_status[];
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.number := OLD.number; END IF;
  IF current_user <> 'core_app' OR app.can_review_sla(NEW.event_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_center IS NOT NULL OR NEW.status = ANY (v_restricted) THEN
      RAISE EXCEPTION 'só o diretor de produção define este status ou o centro de custo' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.cost_center IS DISTINCT FROM OLD.cost_center THEN
    RAISE EXCEPTION 'só o diretor de produção muda o centro de custo' USING ERRCODE = 'insufficient_privilege';
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
CREATE TRIGGER cost_items_guard
  BEFORE INSERT OR UPDATE ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_guard();

ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_unit_len CHECK (unit IS NULL OR char_length(unit) <= 20),
  ADD CONSTRAINT cost_items_location_len CHECK (location IS NULL OR char_length(location) <= 200),
  ADD CONSTRAINT cost_items_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000);

-- participants tem UPDATE por coluna para a aplicação: libera as duas novas.
GRANT UPDATE (company, direct_manager) ON participants TO core_app;

ALTER TABLE participants
  ADD CONSTRAINT participants_company_len CHECK (company IS NULL OR char_length(company) <= 120),
  ADD CONSTRAINT participants_direct_manager_len CHECK (direct_manager IS NULL OR char_length(direct_manager) <= 120);

ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_responsible_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_area_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ─────────────────────── Status que mudam sozinhos ───────────────────────

-- Só avança: um item que já está adiante no fluxo não volta.
CREATE FUNCTION app.advance_item(p_item uuid, p_status item_status) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE cost_items SET status = p_status, updated_at = now() WHERE id = p_item AND status < p_status;
$$;
REVOKE ALL ON FUNCTION app.advance_item(uuid, item_status) FROM PUBLIC;

-- Cotação ligada a um item: enviada → Em cotação; 1º orçamento → Cotação
-- recebida; 3 orçamentos → Em aprovação; vencedor escolhido → Aprovado.
CREATE FUNCTION app.sync_quote_item(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r quote_requests%ROWTYPE;
  v_quotes int;
  v_target item_status;
BEGIN
  SELECT * INTO r FROM quote_requests WHERE id = p_request;
  IF r.id IS NULL OR r.cost_item_id IS NULL OR r.status = 'CANCELADA' THEN RETURN; END IF;
  SELECT count(*) INTO v_quotes FROM supplier_quotes WHERE request_id = r.id;
  v_target := CASE
    WHEN r.status = 'FECHADA' AND r.chosen_quote_id IS NOT NULL THEN 'APROVADO'
    WHEN r.completed_at IS NOT NULL THEN 'EM_APROVACAO'
    WHEN v_quotes > 0 THEN 'COTACAO_RECEBIDA'
    WHEN r.status = 'ENVIADA' THEN 'EM_COTACAO'
  END;
  IF v_target IS NOT NULL THEN PERFORM app.advance_item(r.cost_item_id, v_target); END IF;
END $$;
REVOKE ALL ON FUNCTION app.sync_quote_item(uuid) FROM PUBLIC;

CREATE FUNCTION quote_requests_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.sync_quote_item(NEW.id);
  RETURN NULL;
END $$;
CREATE TRIGGER quote_requests_item_status
  AFTER INSERT OR UPDATE OF status, cost_item_id, completed_at, chosen_quote_id ON quote_requests
  FOR EACH ROW EXECUTE FUNCTION quote_requests_item_status();

CREATE FUNCTION supplier_quotes_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.sync_quote_item(NEW.request_id);
  RETURN NULL;
END $$;
CREATE TRIGGER supplier_quotes_item_status
  AFTER INSERT ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION supplier_quotes_item_status();

-- Quem recebe conferiu o item no campo (chegou certo ou diferente) → No local.
CREATE FUNCTION item_receipts_item_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'PENDENTE' THEN PERFORM app.advance_item(NEW.cost_item_id, 'NO_LOCAL'); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER item_receipts_item_status
  AFTER UPDATE OF status ON item_receipts
  FOR EACH ROW EXECUTE FUNCTION item_receipts_item_status();

-- Itens ligados a cotações que já existem: acerta o status agora.
SELECT app.sync_quote_item(id) FROM quote_requests WHERE cost_item_id IS NOT NULL;
UPDATE cost_items i SET status = 'NO_LOCAL'
  FROM item_receipts r WHERE r.cost_item_id = i.id AND r.status <> 'PENDENTE' AND i.status < 'NO_LOCAL';
