-- Pré-produção: visita técnica ao local do evento. Quem vai (Gerente ou
-- Pré-produtor do evento), data e horário, e os EPIs necessários para a visita.
-- Só a Pré-produção (Gerente, Pré-produtor e Admin) vê. Quem marcou, quem vai
-- e o gestor mudam ou apagam a visita.

-- CreateTable
CREATE TABLE "technical_visits" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "place" TEXT,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "responsible_id" UUID NOT NULL,
    "ppe" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ppe_other" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "technical_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "technical_visits_event_id_scheduled_at_idx" ON "technical_visits"("event_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "technical_visits_event_id_id_key" ON "technical_visits"("event_id", "id");

-- AddForeignKey
ALTER TABLE "technical_visits" ADD CONSTRAINT "technical_visits_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_visits" ADD CONSTRAINT "technical_visits_event_id_responsible_id_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_visits" ADD CONSTRAINT "technical_visits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE technical_visits
  ALTER COLUMN ppe SET NOT NULL,
  ADD CONSTRAINT technical_visits_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT technical_visits_ppe_size CHECK (cardinality(ppe) <= 30);

-- Quem vai à visita é da Pré-produção do evento (Gerente ou Pré-produtor), ativo.
CREATE FUNCTION technical_visits_responsible_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id
       AND p.role IN ('GERENTE', 'PRE_PRODUTOR') AND p.active AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Quem vai à visita técnica precisa ser Gerente ou Pré-produtor do evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION technical_visits_responsible_check() FROM PUBLIC;
CREATE TRIGGER technical_visits_responsible_check
  BEFORE INSERT OR UPDATE OF responsible_id ON technical_visits
  FOR EACH ROW EXECUTE FUNCTION technical_visits_responsible_check();

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE technical_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technical_visits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON technical_visits TO core_app;

CREATE POLICY app_select ON technical_visits FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON technical_visits FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
-- Mudar ou apagar: o gestor, quem marcou ou quem vai.
CREATE POLICY app_update ON technical_visits FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id) AND (
    app.can_review_sla(event_id) OR created_by = app.current_user_id() OR app.is_me(event_id, responsible_id)))
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON technical_visits FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id) AND (
    app.can_review_sla(event_id) OR created_by = app.current_user_id() OR app.is_me(event_id, responsible_id)));
