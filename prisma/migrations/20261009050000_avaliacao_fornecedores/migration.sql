-- CreateTable
CREATE TABLE "supplier_ratings" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "quality" SMALLINT NOT NULL,
    "deadline" SMALLINT NOT NULL,
    "service" SMALLINT NOT NULL,
    "cost" SMALLINT NOT NULL,
    "flexibility" SMALLINT NOT NULL,
    "problem_solving" SMALLINT NOT NULL,
    "comment" TEXT,
    "rated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_ratings_supplier_id_idx" ON "supplier_ratings"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_ratings_event_id_supplier_id_key" ON "supplier_ratings"("event_id", "supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_ratings" ADD CONSTRAINT "supplier_ratings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ratings" ADD CONSTRAINT "supplier_ratings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_ratings" ADD CONSTRAINT "supplier_ratings_rated_by_fkey" FOREIGN KEY ("rated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────── Regras ───────────────────────────────

ALTER TABLE supplier_ratings
  ADD CONSTRAINT supplier_ratings_scores CHECK (
    quality BETWEEN 0 AND 10 AND deadline BETWEEN 0 AND 10 AND service BETWEEN 0 AND 10
    AND cost BETWEEN 0 AND 10 AND flexibility BETWEEN 0 AND 10 AND problem_solving BETWEEN 0 AND 10
  ),
  ADD CONSTRAINT supplier_ratings_comment_len CHECK (comment IS NULL OR char_length(comment) <= 1000);

-- Só o diretor (Gerente do evento ou Admin da agência, sem o Suporte) avalia,
-- com o evento no Fechamento ou concluído e um contrato assinado com o
-- fornecedor no evento. Evento, fornecedor e autor não mudam.
CREATE FUNCTION supplier_ratings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e events%ROWTYPE;
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.event_id <> OLD.event_id OR NEW.supplier_id <> OLD.supplier_id) THEN
    RAISE EXCEPTION 'Evento e fornecedor da avaliação não mudam' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM events WHERE id = NEW.event_id;
  IF NOT (app.can_review_sla(NEW.event_id) AND app.is_agency_director(e.agency_id)) THEN
    RAISE EXCEPTION 'Só o diretor avalia o fornecedor' USING ERRCODE = '42501';
  END IF;
  IF NEW.rated_by IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION 'A avaliação fica no nome de quem avaliou' USING ERRCODE = '42501';
  END IF;
  IF e.deleted_at IS NOT NULL OR e.status NOT IN ('FECHAMENTO', 'CONCLUIDO') THEN
    RAISE EXCEPTION 'A avaliação abre quando o evento chega no Fechamento' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contracts c WHERE c.event_id = NEW.event_id AND c.supplier_id = NEW.supplier_id AND c.status = 'ASSINADO') THEN
    RAISE EXCEPTION 'Só fornecedor com contrato assinado no evento é avaliado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION supplier_ratings_guard() FROM PUBLIC;
CREATE TRIGGER supplier_ratings_guard
  BEFORE INSERT OR UPDATE ON supplier_ratings
  FOR EACH ROW EXECUTE FUNCTION supplier_ratings_guard();

-- ─────────────────────────────── Acesso ───────────────────────────────

-- As notas de cada evento (e o comentário): só o diretor e o Suporte da
-- agência. Não se apaga.
ALTER TABLE supplier_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_ratings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON supplier_ratings TO core_app;

CREATE POLICY app_select ON supplier_ratings FOR SELECT TO core_app
  USING (app.is_agency_admin(app.supplier_agency(supplier_id)) OR app.is_agency_director(app.supplier_agency(supplier_id)));
CREATE POLICY app_insert ON supplier_ratings FOR INSERT TO core_app
  WITH CHECK (app.can_review_sla(event_id) AND rated_by = app.current_user_id());
CREATE POLICY app_update ON supplier_ratings FOR UPDATE TO core_app
  USING (app.can_review_sla(event_id))
  WITH CHECK (app.can_review_sla(event_id) AND rated_by = app.current_user_id());

-- Médias por fornecedor (todos os eventos da agência), para quem vê o
-- cadastro: o Pré-produtor vê a média, não as notas de cada evento.
CREATE FUNCTION app.supplier_rating_summary(p_agency uuid)
RETURNS TABLE (
  supplier_id uuid, ratings integer, overall numeric, quality numeric, deadline numeric, service numeric,
  cost numeric, flexibility numeric, problem_solving numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.supplier_id, count(*)::integer,
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
REVOKE ALL ON FUNCTION app.supplier_rating_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.supplier_rating_summary(uuid) TO core_app;
