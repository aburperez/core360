-- CreateTable
CREATE TABLE "event_tasks" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_on" DATE,
    "area_id" UUID,
    "responsible_id" UUID,
    "done_at" TIMESTAMPTZ(3),
    "done_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_tasks_event_id_due_on_idx" ON "event_tasks"("event_id", "due_on");

-- AddForeignKey
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_area_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_responsible_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tasks" ADD CONSTRAINT "event_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────── Regras ───────────────────────────────

ALTER TABLE event_tasks
  ADD CONSTRAINT event_tasks_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  ADD CONSTRAINT event_tasks_done_complete CHECK ((done_at IS NULL) = (done_by IS NULL));

-- A pendência não muda de evento nem de autor; quem marca feito fica no próprio nome.
CREATE FUNCTION event_tasks_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.event_id <> OLD.event_id THEN
    RAISE EXCEPTION 'A pendência não muda de evento' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'Quem criou a pendência não muda' USING ERRCODE = '23514';
  END IF;
  IF NEW.done_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.done_at IS DISTINCT FROM OLD.done_at OR NEW.done_by IS DISTINCT FROM OLD.done_by)
     AND NEW.done_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'A pendência fica feita no nome de quem marcou' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_tasks_guard() FROM PUBLIC;
CREATE TRIGGER event_tasks_guard
  BEFORE INSERT OR UPDATE ON event_tasks
  FOR EACH ROW EXECUTE FUNCTION event_tasks_guard();

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Só a Pré-produção (e o Admin/Suporte da agência). O campo e o cliente não veem.
ALTER TABLE event_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_tasks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_tasks TO core_app;

CREATE POLICY app_select ON event_tasks FOR SELECT TO core_app USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON event_tasks FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON event_tasks FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id)) WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON event_tasks FOR DELETE TO core_app USING (app.can_use_pre_production(event_id));
