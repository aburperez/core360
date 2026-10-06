-- CreateTable
CREATE TABLE "briefings" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "role_text" TEXT,
    "post" TEXT,
    "schedule" TEXT,
    "duties" TEXT,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "read_version" INTEGER NOT NULL DEFAULT 0,
    "read_at" TIMESTAMPTZ(3),
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "briefings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_notes" (
    "event_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_notes_pkey" PRIMARY KEY ("event_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "briefings_participant_id_key" ON "briefings"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "briefings_event_id_participant_id_key" ON "briefings"("event_id", "participant_id");

-- AddForeignKey
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefings" ADD CONSTRAINT "briefings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE briefings
  -- Briefing vazio não existe: ao menos um campo preenchido.
  ADD CONSTRAINT briefings_not_empty CHECK (
    btrim(coalesce(role_text, '') || coalesce(post, '') || coalesce(schedule, '') || coalesce(duties, '') || coalesce(notes, '')) <> ''
  ),
  ADD CONSTRAINT briefings_version_positive CHECK (version >= 1),
  ADD CONSTRAINT briefings_read_version_range CHECK (read_version >= 0 AND read_version <= version),
  ADD CONSTRAINT briefings_read_at CHECK ((read_version = 0) = (read_at IS NULL));

ALTER TABLE daily_notes
  ADD CONSTRAINT daily_notes_body_not_blank CHECK (btrim(body) <> '');

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Observações do dia no relatório: só o gestor (Gerente ou Admin) escreve.
CREATE FUNCTION app.can_write_report(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_admin() OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;
REVOKE ALL ON FUNCTION app.can_write_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_write_report(uuid) TO core_app;

ALTER TABLE briefings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON briefings, daily_notes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON briefings, daily_notes TO core_app;

-- Briefing: a Pré-produção escreve e vê todos; cada pessoa vê só o seu.
CREATE POLICY app_select ON briefings FOR SELECT TO core_app USING (
  app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id)
);
CREATE POLICY app_insert ON briefings FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON briefings FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));
-- A pessoa só confirma a leitura (o gatilho abaixo diz o que cada um muda).
CREATE POLICY app_update ON briefings FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id))
  WITH CHECK (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));

-- Versão, autor e leitura são do banco, não do navegador:
--  * texto mudou: versão sobe e o autor é quem está logado;
--  * só a própria pessoa confirma a leitura, e só da versão atual;
--  * quem não é da Pré-produção não muda o texto;
--  * briefing é para gente do campo (Gerente, Head, Operacional) ativa no evento.
CREATE FUNCTION briefings_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := app.current_user_id();
  v_text_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_text_changed := true;
    NEW.version := 1;
    IF v_user IS NOT NULL THEN
      NEW.read_version := 0;
      NEW.read_at := NULL;
    END IF;
  ELSE
    IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id THEN
      RAISE EXCEPTION 'o briefing é sempre da mesma pessoa' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_text_changed := NEW.role_text IS DISTINCT FROM OLD.role_text
      OR NEW.post     IS DISTINCT FROM OLD.post
      OR NEW.schedule IS DISTINCT FROM OLD.schedule
      OR NEW.duties   IS DISTINCT FROM OLD.duties
      OR NEW.notes    IS DISTINCT FROM OLD.notes;
    NEW.version := CASE WHEN v_text_changed THEN OLD.version + 1 ELSE OLD.version END;
  END IF;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_text_changed THEN
    IF NOT app.can_use_pre_production(NEW.event_id) THEN
      RAISE EXCEPTION 'só a pré-produção escreve o briefing' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.updated_by := v_user;
  ELSIF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    RAISE EXCEPTION 'autor do briefing não muda sem mudar o texto' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.read_version IS DISTINCT FROM OLD.read_version OR NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    IF NOT app.is_me(NEW.event_id, NEW.participant_id) OR v_text_changed
       OR NEW.read_version <> NEW.version OR NEW.read_at IS NULL THEN
      RAISE EXCEPTION 'só a própria pessoa confirma a leitura do briefing atual' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.read_at := now();
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id
       AND p.active AND p.deleted_at IS NULL
       AND p.role IN ('GERENTE', 'HEAD', 'OPERACIONAL')
  ) THEN
    RAISE EXCEPTION 'briefing é para alguém do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER briefings_guard
  BEFORE INSERT OR UPDATE ON briefings
  FOR EACH ROW EXECUTE FUNCTION briefings_guard();

-- No "Meu briefing" a pessoa vê os tipos de atendimento que ela faz.
CREATE POLICY app_select_mine ON service_type_people FOR SELECT TO core_app
  USING (app.is_me(event_id, participant_id));

-- Observações do dia: a Pré-produção lê; o gestor escreve.
CREATE POLICY app_select ON daily_notes FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON daily_notes FOR INSERT TO core_app
  WITH CHECK (app.can_write_report(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON daily_notes FOR UPDATE TO core_app
  USING (app.can_write_report(event_id))
  WITH CHECK (app.can_write_report(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_delete ON daily_notes FOR DELETE TO core_app
  USING (app.can_write_report(event_id));

-- Relatório diário: números e lista dos chamados para a Pré-produção.
-- O Pré-produtor não abre chamados (RLS de occurrences), então o relatório
-- passa por esta função, que devolve só o que o relatório mostra: número,
-- título, equipe, tipo, situação e horários. Sem descrição, fotos ou pessoas.
CREATE FUNCTION app.report_occurrences(p_event uuid)
RETURNS TABLE (
  id uuid, number integer, type occurrence_type, title text,
  area_name text, team_name text, service_type_name text,
  status occurrence_status, priority priority,
  opened_at timestamptz, sla_due_at timestamptz, concluded_at timestamptz,
  duration_seconds integer, sla_breached boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app.can_use_pre_production(p_event) THEN
    RAISE EXCEPTION 'relatório é da pré-produção' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.id, o.number, o.type, o.title,
           a.name, t.name, st.name,
           o.status, o.priority,
           o.opened_at, o.sla_due_at, o.concluded_at,
           o.duration_seconds, o.sla_breached
      FROM occurrences o
      JOIN areas a ON a.id = o.area_id
      JOIN teams t ON t.id = o.team_id
      LEFT JOIN service_types st ON st.id = o.service_type_id
     WHERE o.event_id = p_event
     ORDER BY o.number;
END $$;
REVOKE ALL ON FUNCTION app.report_occurrences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.report_occurrences(uuid) TO core_app;
