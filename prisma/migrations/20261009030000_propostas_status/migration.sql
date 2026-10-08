-- CreateEnum
CREATE TYPE "proposal_status" AS ENUM ('SOLICITADA', 'RECEBIDA', 'EM_NEGOCIACAO', 'APROVADA', 'RECUSADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "supplier_quotes" ADD COLUMN     "negotiated_at" TIMESTAMPTZ(3),
ADD COLUMN     "negotiated_by" UUID,
ADD COLUMN     "negotiated_value" DECIMAL(14,2),
ADD COLUMN     "negotiation_note" TEXT,
ADD COLUMN     "status" "proposal_status" NOT NULL DEFAULT 'RECEBIDA',
ALTER COLUMN "total_value" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_negotiated_by_fkey" FOREIGN KEY ("negotiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────── Status das propostas e negociação (fase 3C) ───────────────────

-- Propostas que já existem: a escolhida fica Aprovada, as outras da cotação
-- fechada ficam Recusadas; o resto, Recebida (todas já têm valor).
UPDATE supplier_quotes q
   SET status = CASE WHEN r.chosen_quote_id = q.id THEN 'APROVADA'::proposal_status
                     WHEN r.status = 'FECHADA' THEN 'RECUSADA'::proposal_status
                     ELSE 'RECEBIDA'::proposal_status END
  FROM quote_requests r
 WHERE r.id = q.request_id;

ALTER TABLE supplier_quotes
  -- Solicitada é a que ainda não tem valor; Recebida, Em negociação e Aprovada têm.
  ADD CONSTRAINT supplier_quotes_status_value CHECK (
    (status <> 'SOLICITADA' OR total_value IS NULL)
    AND (status NOT IN ('RECEBIDA', 'EM_NEGOCIACAO', 'APROVADA') OR total_value IS NOT NULL)
  ),
  ADD CONSTRAINT supplier_quotes_negotiated_nonneg CHECK (negotiated_value IS NULL OR (negotiated_value >= 0 AND total_value IS NOT NULL)),
  ADD CONSTRAINT supplier_quotes_negotiated_complete CHECK (
    (negotiated_value IS NULL) = (negotiated_at IS NULL) AND (negotiated_value IS NULL) = (negotiated_by IS NULL)
    AND (negotiated_value IS NOT NULL OR negotiation_note IS NULL)
  ),
  ADD CONSTRAINT supplier_quotes_negotiation_note_len CHECK (char_length(negotiation_note) <= 500);

-- Só o diretor (gestor do evento) negocia o valor, e depois da negociação só
-- ele corrige o valor recebido. Aprovada só a escolhida; Recusada só com outra
-- escolhida; e só sai de Aprovada/Recusada quando a cotação é reaberta.
CREATE FUNCTION supplier_quotes_proposal_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_chosen uuid;
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.negotiated_value IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND (NEW.negotiated_value IS DISTINCT FROM OLD.negotiated_value
                               OR (OLD.negotiated_value IS NOT NULL AND NEW.total_value IS DISTINCT FROM OLD.total_value))) THEN
    IF NOT app.can_review_sla(NEW.event_id) THEN
      RAISE EXCEPTION 'Só o diretor negocia o valor da proposta' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT chosen_quote_id INTO v_chosen FROM quote_requests WHERE id = NEW.request_id;
  IF NEW.status = 'APROVADA' AND v_chosen IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Aprovada só a proposta escolhida pelo diretor' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'RECUSADA' AND (v_chosen IS NULL OR v_chosen = NEW.id) THEN
    RAISE EXCEPTION 'Recusada só quando outra proposta foi escolhida' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('APROVADA', 'RECUSADA') AND v_chosen IS NOT NULL THEN
    RAISE EXCEPTION 'A cotação está fechada. Para mudar, o diretor precisa reabrir.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION supplier_quotes_proposal_guard() FROM PUBLIC;
CREATE TRIGGER supplier_quotes_proposal_guard
  BEFORE INSERT OR UPDATE ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION supplier_quotes_proposal_guard();

-- O item só fica "Cotação recebida" quando chega uma proposta com valor.
CREATE OR REPLACE FUNCTION app.sync_quote_item(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r quote_requests%ROWTYPE;
  v_quotes int;
  v_target item_status;
BEGIN
  SELECT * INTO r FROM quote_requests WHERE id = p_request;
  IF r.id IS NULL OR r.cost_item_id IS NULL OR r.status = 'CANCELADA' THEN RETURN; END IF;
  SELECT count(*) INTO v_quotes FROM supplier_quotes
   WHERE request_id = r.id AND total_value IS NOT NULL AND status <> 'CANCELADA';
  v_target := CASE
    WHEN r.status = 'FECHADA' AND r.chosen_quote_id IS NOT NULL THEN 'APROVADO'
    WHEN r.completed_at IS NOT NULL THEN 'EM_APROVACAO'
    WHEN v_quotes > 0 THEN 'COTACAO_RECEBIDA'
    WHEN r.status = 'ENVIADA' THEN 'EM_COTACAO'
  END;
  IF v_target IS NOT NULL THEN PERFORM app.advance_item(r.cost_item_id, v_target); END IF;
END $$;

DROP TRIGGER supplier_quotes_item_status ON supplier_quotes;
CREATE TRIGGER supplier_quotes_item_status
  AFTER INSERT OR UPDATE OF total_value, status ON supplier_quotes
  FOR EACH ROW EXECUTE FUNCTION supplier_quotes_item_status();
