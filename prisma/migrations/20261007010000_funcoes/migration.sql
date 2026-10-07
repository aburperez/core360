-- Painel de funções (Pré-produção › Funções):
--  * funções do evento, escritas uma vez e aplicadas a muitas pessoas;
--  * atividades com dia e horário, da função ou de uma pessoa só;
--  * "feito" marcado pela própria pessoa;
--  * ficha da pessoa (função e dados para a produção), que só a
--    Pré-produção e a própria pessoa veem.

-- CreateTable
CREATE TABLE "event_functions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "function_id" UUID,
    "participant_id" UUID,
    "title" TEXT NOT NULL,
    "day" DATE,
    "start_time" TEXT,
    "end_time" TEXT,
    "place" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_checks" (
    "activity_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "done_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_checks_pkey" PRIMARY KEY ("activity_id","participant_id")
);

-- CreateTable
CREATE TABLE "participant_profiles" (
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "function_id" UUID,
    "document" TEXT,
    "uniform_size" TEXT,
    "dietary" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_profiles_pkey" PRIMARY KEY ("participant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_functions_event_id_id_key" ON "event_functions"("event_id", "id");

-- CreateIndex
CREATE INDEX "activities_event_id_function_id_idx" ON "activities"("event_id", "function_id");

-- CreateIndex
CREATE INDEX "activities_event_id_participant_id_idx" ON "activities"("event_id", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_event_id_id_key" ON "activities"("event_id", "id");

-- CreateIndex
CREATE INDEX "activity_checks_event_id_participant_id_idx" ON "activity_checks"("event_id", "participant_id");

-- CreateIndex
CREATE INDEX "participant_profiles_event_id_function_id_idx" ON "participant_profiles"("event_id", "function_id");

-- CreateIndex
CREATE UNIQUE INDEX "participant_profiles_event_id_participant_id_key" ON "participant_profiles"("event_id", "participant_id");

-- AddForeignKey
ALTER TABLE "event_functions" ADD CONSTRAINT "event_functions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_functions" ADD CONSTRAINT "event_functions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_event_id_function_id_fkey" FOREIGN KEY ("event_id", "function_id") REFERENCES "event_functions"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_checks" ADD CONSTRAINT "activity_checks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_checks" ADD CONSTRAINT "activity_checks_event_id_activity_id_fkey" FOREIGN KEY ("event_id", "activity_id") REFERENCES "activities"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_checks" ADD CONSTRAINT "activity_checks_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_event_id_function_id_fkey" FOREIGN KEY ("event_id", "function_id") REFERENCES "event_functions"("event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_profiles" ADD CONSTRAINT "participant_profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE event_functions
  ADD CONSTRAINT event_functions_name_not_blank CHECK (btrim(name) <> '');
-- Duas funções com o mesmo nome no mesmo evento confundem: uma só.
CREATE UNIQUE INDEX event_functions_event_name_unique ON event_functions (event_id, lower(btrim(name)));

ALTER TABLE activities
  -- Da função ou de uma pessoa, nunca dos dois nem de nenhum.
  ADD CONSTRAINT activities_owner CHECK (num_nonnulls(function_id, participant_id) = 1),
  ADD CONSTRAINT activities_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT activities_start_time CHECK (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT activities_end_time CHECK (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT activities_end_needs_start CHECK (end_time IS NULL OR start_time IS NOT NULL);

-- ─────────────────────────────── Acesso ───────────────────────────────

-- A atividade é desta pessoa? Dela mesma, ou da função que ela tem.
CREATE FUNCTION app.activity_applies(p_activity uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
     WHERE a.id = p_activity
       AND (a.participant_id = p_participant
         OR a.function_id = (SELECT pp.function_id FROM participant_profiles pp
                              WHERE pp.participant_id = p_participant AND pp.event_id = a.event_id))
  )
$$;
REVOKE ALL ON FUNCTION app.activity_applies(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.activity_applies(uuid, uuid) TO core_app;

-- A função é a minha neste evento? (para ver o nome e as atividades dela)
CREATE FUNCTION app.is_my_function(p_event uuid, p_function uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM participant_profiles pp
      JOIN app.membership(p_event) m ON m.participant_id = pp.participant_id
     WHERE pp.event_id = p_event AND pp.function_id = p_function
  )
$$;
REVOKE ALL ON FUNCTION app.is_my_function(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_my_function(uuid, uuid) TO core_app;

ALTER TABLE event_functions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_checks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_functions, activities, activity_checks, participant_profiles FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_functions, activities TO core_app;
GRANT SELECT, INSERT, DELETE ON activity_checks TO core_app;
GRANT SELECT, INSERT, UPDATE ON participant_profiles TO core_app;

-- Funções: a Pré-produção escreve e vê todas; a pessoa vê só a dela.
CREATE POLICY app_select ON event_functions FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_my_function(event_id, id));
CREATE POLICY app_insert ON event_functions FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON event_functions FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id)) WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON event_functions FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));

-- Atividades: idem; a pessoa vê as da função dela e as só dela.
CREATE POLICY app_select ON activities FOR SELECT TO core_app USING (
  app.can_use_pre_production(event_id)
  OR (participant_id IS NOT NULL AND app.is_me(event_id, participant_id))
  OR (function_id IS NOT NULL AND app.is_my_function(event_id, function_id))
);
CREATE POLICY app_insert ON activities FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON activities FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id)) WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON activities FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));

-- Feito: a Pré-produção acompanha; só a própria pessoa marca ou desmarca,
-- e só nas atividades que são dela.
CREATE POLICY app_select ON activity_checks FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));
CREATE POLICY app_insert ON activity_checks FOR INSERT TO core_app
  WITH CHECK (app.is_me(event_id, participant_id) AND app.activity_applies(activity_id, participant_id));
CREATE POLICY app_delete ON activity_checks FOR DELETE TO core_app
  USING (app.is_me(event_id, participant_id));

-- Ficha: a Pré-produção e a própria pessoa.
CREATE POLICY app_select ON participant_profiles FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));
CREATE POLICY app_insert ON participant_profiles FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));
CREATE POLICY app_update ON participant_profiles FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id))
  WITH CHECK (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));

-- Quem recebe função, ficha e atividade: gente do campo ativa no evento.
CREATE FUNCTION app.is_field_person(p_event uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = p_participant AND p.event_id = p_event
       AND p.active AND p.deleted_at IS NULL
       AND p.role IN ('GERENTE', 'HEAD', 'OPERACIONAL')
  )
$$;
REVOKE ALL ON FUNCTION app.is_field_person(uuid, uuid) FROM PUBLIC;

-- Ficha: o autor é quem está logado; a pessoa preenche os dados dela, mas
-- a função quem dá é a Pré-produção.
CREATE FUNCTION participant_profiles_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := app.current_user_id();
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id) THEN
    RAISE EXCEPTION 'a ficha é sempre da mesma pessoa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' AND NOT app.is_field_person(NEW.event_id, NEW.participant_id) THEN
    RAISE EXCEPTION 'ficha é para alguém do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.updated_by := v_user;
  IF NOT app.can_use_pre_production(NEW.event_id)
     AND NEW.function_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.function_id END) THEN
    RAISE EXCEPTION 'só a pré-produção escolhe a função' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER participant_profiles_guard
  BEFORE INSERT OR UPDATE ON participant_profiles
  FOR EACH ROW EXECUTE FUNCTION participant_profiles_guard();

-- Atividade: não troca de dono; a de uma pessoa é para gente do campo.
CREATE FUNCTION activities_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.function_id IS DISTINCT FROM OLD.function_id
       OR NEW.participant_id IS DISTINCT FROM OLD.participant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'a atividade não troca de dono' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.participant_id IS NOT NULL AND NOT app.is_field_person(NEW.event_id, NEW.participant_id) THEN
    RAISE EXCEPTION 'atividade é para alguém do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER activities_guard
  BEFORE INSERT OR UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION activities_guard();

-- Feito: a hora é a do banco, não a do celular.
CREATE FUNCTION activity_checks_stamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.done_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER activity_checks_stamp
  BEFORE INSERT ON activity_checks
  FOR EACH ROW EXECUTE FUNCTION activity_checks_stamp();
