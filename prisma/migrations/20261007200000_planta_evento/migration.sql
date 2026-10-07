-- Planta do evento (pedido do Abu, 2026-10-07): uma aba na Gestão de campo
-- com a planta, para ninguém precisar trocar de app, e marcações de onde
-- acontece cada etapa de montagem ou de finalização.
--   • O Gerente envia as plantas (imagem; o navegador converte PDF em imagem).
--   • O Gerente, ou o Head da área da etapa, marca e edita as etapas.
--   • Quem é da equipe da etapa, o responsável, o Head e o Gerente marcam
--     Iniciar / Concluir (com foto opcional).
--   • Todos do campo veem (o Pré-produtor não tem campo).

-- CreateEnum
CREATE TYPE "plan_point_kind" AS ENUM ('MONTAGEM', 'FINALIZACAO');

-- CreateEnum
CREATE TYPE "plan_point_status" AS ENUM ('NAO_INICIADO', 'EM_ANDAMENTO', 'CONCLUIDO');

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_points" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "plan_point_kind" NOT NULL,
    "area_id" UUID,
    "team_id" UUID,
    "responsible_id" UUID,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "status" "plan_point_status" NOT NULL DEFAULT 'NAO_INICIADO',
    "started_at" TIMESTAMPTZ(3),
    "started_by" UUID,
    "finished_at" TIMESTAMPTZ(3),
    "finished_by" UUID,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_point_photos" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "point_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_point_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "floor_plans_storage_key_key" ON "floor_plans"("storage_key");

-- CreateIndex
CREATE INDEX "floor_plans_event_id_idx" ON "floor_plans"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "floor_plans_event_id_id_key" ON "floor_plans"("event_id", "id");

-- CreateIndex
CREATE INDEX "plan_points_event_id_plan_id_idx" ON "plan_points"("event_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_points_event_id_id_key" ON "plan_points"("event_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_point_photos_storage_key_key" ON "plan_point_photos"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_point_photos_point_id_sha256_key" ON "plan_point_photos"("point_id", "sha256");

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_points" ADD CONSTRAINT "plan_points_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_points" ADD CONSTRAINT "plan_points_event_id_plan_id_fkey" FOREIGN KEY ("event_id", "plan_id") REFERENCES "floor_plans"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_points" ADD CONSTRAINT "plan_points_event_id_area_id_fkey" FOREIGN KEY ("event_id", "area_id") REFERENCES "areas"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_points" ADD CONSTRAINT "plan_points_event_id_area_id_team_id_fkey" FOREIGN KEY ("event_id", "area_id", "team_id") REFERENCES "teams"("event_id", "area_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_points" ADD CONSTRAINT "plan_points_event_id_responsible_id_fkey" FOREIGN KEY ("event_id", "responsible_id") REFERENCES "participants"("event_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_point_photos" ADD CONSTRAINT "plan_point_photos_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_point_photos" ADD CONSTRAINT "plan_point_photos_event_id_point_id_fkey" FOREIGN KEY ("event_id", "point_id") REFERENCES "plan_points"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE floor_plans
  ADD CONSTRAINT floor_plans_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT floor_plans_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);

ALTER TABLE plan_points
  ADD CONSTRAINT plan_points_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT plan_points_xy CHECK (x >= 0 AND x <= 100 AND y >= 0 AND y <= 100),
  ADD CONSTRAINT plan_points_team_needs_area CHECK (team_id IS NULL OR area_id IS NOT NULL),
  ADD CONSTRAINT plan_points_period CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at),
  -- Situação e horários andam juntos.
  ADD CONSTRAINT plan_points_status_times CHECK (
    (status = 'NAO_INICIADO' AND started_at IS NULL AND finished_at IS NULL)
    OR (status = 'EM_ANDAMENTO' AND started_at IS NOT NULL AND finished_at IS NULL)
    OR (status = 'CONCLUIDO' AND finished_at IS NOT NULL)
  );

ALTER TABLE plan_point_photos
  ADD CONSTRAINT plan_point_photos_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);

-- ─────────────────────────────── Acesso ───────────────────────────────

-- Gestão de campo: todos do evento menos o Pré-produtor.
CREATE FUNCTION app.can_use_field(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role <> 'PRE_PRODUTOR'
  )
$$;

-- Enviar, renomear e apagar plantas: o gestor.
CREATE FUNCTION app.can_manage_plans(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

-- Marcar, editar e apagar uma etapa: o gestor, ou o Head da área da etapa.
CREATE FUNCTION app.can_edit_plan_point(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role = 'GERENTE'
        OR (m.role = 'HEAD' AND p_area IS NOT NULL AND m.area_id = p_area)
  )
$$;

-- Iniciar e concluir: quem edita, o responsável e o Operacional da equipe da etapa.
CREATE FUNCTION app.can_work_plan_point(p_event uuid, p_area uuid, p_team uuid, p_responsible uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_edit_plan_point(p_event, p_area) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('HEAD', 'OPERACIONAL')
       AND ((p_responsible IS NOT NULL AND m.participant_id = p_responsible)
         OR (m.role = 'OPERACIONAL' AND p_team IS NOT NULL AND m.team_id = p_team))
  )
$$;

REVOKE ALL ON FUNCTION app.can_use_field(uuid), app.can_manage_plans(uuid), app.can_edit_plan_point(uuid, uuid),
  app.can_work_plan_point(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_use_field(uuid), app.can_manage_plans(uuid), app.can_edit_plan_point(uuid, uuid),
  app.can_work_plan_point(uuid, uuid, uuid, uuid) TO core_app;

ALTER TABLE floor_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_points       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_point_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_plans, plan_points, plan_point_photos FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON floor_plans, plan_points TO core_app;
GRANT SELECT, INSERT ON plan_point_photos TO core_app;

CREATE POLICY app_select ON floor_plans FOR SELECT TO core_app USING (app.can_use_field(event_id));
CREATE POLICY app_insert ON floor_plans FOR INSERT TO core_app
  WITH CHECK (app.can_manage_plans(event_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON floor_plans FOR UPDATE TO core_app
  USING (app.can_manage_plans(event_id)) WITH CHECK (app.can_manage_plans(event_id));
CREATE POLICY app_delete ON floor_plans FOR DELETE TO core_app USING (app.can_manage_plans(event_id));

CREATE POLICY app_select ON plan_points FOR SELECT TO core_app USING (app.can_use_field(event_id));
CREATE POLICY app_insert ON plan_points FOR INSERT TO core_app
  WITH CHECK (app.can_edit_plan_point(event_id, area_id) AND created_by = app.current_user_id());
CREATE POLICY app_update ON plan_points FOR UPDATE TO core_app
  USING (app.can_work_plan_point(event_id, area_id, team_id, responsible_id))
  WITH CHECK (app.can_work_plan_point(event_id, area_id, team_id, responsible_id));
CREATE POLICY app_delete ON plan_points FOR DELETE TO core_app USING (app.can_edit_plan_point(event_id, area_id));

-- Quem só trabalha na etapa muda só a situação; o resto (lugar, nome, área,
-- equipe, pessoa, horários) é de quem edita, e a etapa não sai da área dele.
-- Início e conclusão ficam no nome de quem fez.
CREATE FUNCTION plan_points_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'core_app' THEN
    RETURN NEW;
  END IF;
  IF (NEW.event_id, NEW.plan_id, NEW.x, NEW.y, NEW.name, NEW.description, NEW.kind, NEW.area_id, NEW.team_id,
      NEW.responsible_id, NEW.starts_at, NEW.ends_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.event_id, OLD.plan_id, OLD.x, OLD.y, OLD.name, OLD.description, OLD.kind, OLD.area_id, OLD.team_id,
      OLD.responsible_id, OLD.starts_at, OLD.ends_at, OLD.created_by)
  THEN
    IF NOT app.can_edit_plan_point(OLD.event_id, OLD.area_id) OR NOT app.can_edit_plan_point(NEW.event_id, NEW.area_id) THEN
      RAISE EXCEPTION 'só o gerente ou o head da área muda a etapa' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF (NEW.started_by IS DISTINCT FROM OLD.started_by AND NEW.started_by IS DISTINCT FROM app.current_user_id() AND NEW.started_by IS NOT NULL)
     OR (NEW.finished_by IS DISTINCT FROM OLD.finished_by AND NEW.finished_by IS DISTINCT FROM app.current_user_id() AND NEW.finished_by IS NOT NULL)
  THEN
    RAISE EXCEPTION 'o início e a conclusão ficam no nome de quem fez' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER plan_points_guard
  BEFORE UPDATE ON plan_points
  FOR EACH ROW EXECUTE FUNCTION plan_points_guard();

-- O responsável precisa ser alguém do campo (Gerente, Head ou Operacional) ativo no evento.
CREATE FUNCTION plan_points_check_responsible() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.responsible_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id
       AND p.active AND p.deleted_at IS NULL
       AND p.role IN ('GERENTE', 'HEAD', 'OPERACIONAL')
  ) THEN
    RAISE EXCEPTION 'o responsável precisa ser do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER plan_points_check_responsible
  BEFORE INSERT OR UPDATE OF responsible_id ON plan_points
  FOR EACH ROW EXECUTE FUNCTION plan_points_check_responsible();

-- Fotos da etapa: quem vê a etapa vê a foto; quem trabalha nela envia.
CREATE POLICY app_select ON plan_point_photos FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM plan_points p WHERE p.id = plan_point_photos.point_id)
);
CREATE POLICY app_insert ON plan_point_photos FOR INSERT TO core_app WITH CHECK (
  uploaded_by = app.current_user_id()
  AND EXISTS (
    SELECT 1 FROM plan_points p
     WHERE p.id = plan_point_photos.point_id
       AND app.can_work_plan_point(p.event_id, p.area_id, p.team_id, p.responsible_id)
  )
);

-- Os bytes (arquivos guardados no banco): mesma regra da planta e da foto.
CREATE POLICY app_select_floor_plan ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM floor_plans f WHERE f.storage_key = stored_files.key)
);
CREATE POLICY app_select_plan_photo ON stored_files FOR SELECT TO core_app USING (
  EXISTS (SELECT 1 FROM plan_point_photos p WHERE p.storage_key = stored_files.key)
);
