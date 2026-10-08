-- AlterTable
ALTER TABLE "cost_items" ADD COLUMN     "depends_on_id" UUID;

-- CreateTable
CREATE TABLE "event_milestones" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "responsible_id" UUID,
    "done_at" TIMESTAMPTZ(3),
    "done_by" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_milestones_event_id_due_on_idx" ON "event_milestones"("event_id", "due_on");

-- AddForeignKey
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_depends_on_fkey" FOREIGN KEY ("event_id", "depends_on_id") REFERENCES "cost_items"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_milestones" ADD CONSTRAINT "event_milestones_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_milestones" ADD CONSTRAINT "event_milestones_responsible_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "event_milestones" ADD CONSTRAINT "event_milestones_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_milestones" ADD CONSTRAINT "event_milestones_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────── Regras ───────────────────────────────

ALTER TABLE event_milestones
  ADD CONSTRAINT event_milestones_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  ADD CONSTRAINT event_milestones_done_complete CHECK ((done_at IS NULL) = (done_by IS NULL));
ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_depends_on_self CHECK (depends_on_id IS NULL OR depends_on_id <> id);

-- O marco não muda de evento; quem marca feito fica no próprio nome.
CREATE FUNCTION event_milestones_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'core_app' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.event_id <> OLD.event_id THEN
    RAISE EXCEPTION 'O marco não muda de evento' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Quem criou o marco não muda' USING ERRCODE = '23514';
  END IF;
  IF NEW.done_by IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.done_at IS DISTINCT FROM OLD.done_at OR NEW.done_by IS DISTINCT FROM OLD.done_by)
     AND NEW.done_by <> app.current_user_id() THEN
    RAISE EXCEPTION 'O marco fica feito no nome de quem marcou' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION event_milestones_guard() FROM PUBLIC;
CREATE TRIGGER event_milestones_guard
  BEFORE INSERT OR UPDATE ON event_milestones
  FOR EACH ROW EXECUTE FUNCTION event_milestones_guard();

-- "Depende de": sem voltar em círculo (A depende de B que depende de A).
CREATE FUNCTION cost_items_dependency_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cur uuid := NEW.depends_on_id;
  hops integer := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Esta dependência faz um círculo entre os itens' USING ERRCODE = '23514';
    END IF;
    hops := hops + 1;
    IF hops > 200 THEN EXIT; END IF;
    SELECT depends_on_id INTO cur FROM cost_items WHERE id = cur AND event_id = NEW.event_id;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION cost_items_dependency_check() FROM PUBLIC;
CREATE TRIGGER cost_items_dependency_check
  BEFORE INSERT OR UPDATE OF depends_on_id ON cost_items
  FOR EACH ROW WHEN (NEW.depends_on_id IS NOT NULL)
  EXECUTE FUNCTION cost_items_dependency_check();

-- Apagar um item solta quem dependia dele.
CREATE FUNCTION cost_items_release_dependents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE cost_items SET depends_on_id = NULL WHERE event_id = OLD.event_id AND depends_on_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION cost_items_release_dependents() FROM PUBLIC;
CREATE TRIGGER cost_items_release_dependents
  BEFORE DELETE ON cost_items
  FOR EACH ROW EXECUTE FUNCTION cost_items_release_dependents();

-- ─────────────────────────── Marcos padrão ───────────────────────────

-- T-30 a T0, contados do primeiro dia do evento (no fuso dele). Só cria se o
-- evento ainda não tem marcos.
CREATE FUNCTION default_milestones_insert(p_event uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM event_milestones WHERE event_id = p_event) THEN RETURN 0; END IF;
  INSERT INTO event_milestones (id, event_id, title, due_on, updated_at)
  SELECT gen_random_uuid(), e.id, m.title, (e.starts_at AT TIME ZONE e.timezone)::date - m.days, now()
    FROM events e
    CROSS JOIN (VALUES
      (30, 'Orçamento fechado'),
      (21, 'Cotações concluídas'),
      (15, 'Contratos assinados'),
      (10, 'Visita técnica e planta final'),
      (7, 'Equipe fechada'),
      (3, 'Logística de montagem'),
      (1, 'Checklist final'),
      (0, 'Dia do evento')
    ) AS m(days, title)
   WHERE e.id = p_event;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION default_milestones_insert(uuid) FROM PUBLIC;

-- Evento novo já nasce com o cronograma padrão.
CREATE FUNCTION events_default_milestones() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM default_milestones_insert(NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION events_default_milestones() FROM PUBLIC;
CREATE TRIGGER events_default_milestones
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_default_milestones();

-- Botão "Criar os marcos padrão" (evento sem marcos): só quem usa a Pré-produção.
CREATE FUNCTION app.create_default_milestones(p_event uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.can_use_pre_production(p_event) THEN
    RAISE EXCEPTION 'Sem acesso ao cronograma deste evento' USING ERRCODE = '42501';
  END IF;
  RETURN default_milestones_insert(p_event);
END $$;
REVOKE ALL ON FUNCTION app.create_default_milestones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_default_milestones(uuid) TO core_app;

-- Eventos que ainda vão acontecer ganham o cronograma padrão; os que já
-- passaram ou estão acontecendo ficam com o botão.
SELECT default_milestones_insert(id) FROM events
 WHERE deleted_at IS NULL AND starts_at > now() AND status NOT IN ('CONCLUIDO', 'CANCELADO');

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Só a Pré-produção (e o Admin/Suporte da agência). O campo e o cliente não veem.
ALTER TABLE event_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_milestones FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_milestones TO core_app;

CREATE POLICY app_select ON event_milestones FOR SELECT TO core_app USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON event_milestones FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON event_milestones FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id)) WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON event_milestones FOR DELETE TO core_app USING (app.can_use_pre_production(event_id));
