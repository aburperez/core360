-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDENTE', 'ENVIADO', 'FALHOU', 'IGNORADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'ATRIBUIDA';
ALTER TYPE "notification_type" ADD VALUE 'REPROVADA';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupe_key" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "to_phone" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDENTE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "action_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "opted_in_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "occurrence_changes" (
    "id" BIGSERIAL NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "kind" TEXT NOT NULL,
    "old" JSONB,
    "new" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "occurrence_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_provider_message_id_idx" ON "notification_deliveries"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key" ON "notification_deliveries"("notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrence_changes" ADD CONSTRAINT "occurrence_changes_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────── Avisos: segurança ───────────────────────────
-- Avisos são criados só pelo despacho (papel core_worker), nunca pelo navegador.
-- Assim ninguém consegue mandar aviso falso para outra pessoa.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'core_worker') THEN
    RAISE EXCEPTION 'Crie o papel core_worker antes desta migration (veja docker/init-roles.sql)';
  END IF;
END $$;

ALTER TABLE whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_phone_e164
  CHECK (phone ~ '^\+[1-9][0-9]{9,14}$');
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel
  CHECK (channel IN ('WHATSAPP'));
ALTER TABLE occurrence_changes ADD CONSTRAINT occurrence_changes_kind
  CHECK (kind IN ('CREATE', 'UPDATE'));
CREATE INDEX occurrence_changes_pending ON occurrence_changes (id) WHERE processed_at IS NULL;

-- Outbox: toda criação ou mudança relevante num chamado entra na fila, na mesma
-- transação. Vale para qualquer caminho (API, WhatsApp, offline), sem depender
-- de o código lembrar de avisar.
CREATE FUNCTION occurrences_outbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  snap_new jsonb := jsonb_build_object(
    'status', NEW.status, 'priority', NEW.priority, 'responsible', NEW.responsible_participant_id,
    'areaId', NEW.area_id, 'teamId', NEW.team_id, 'validation', NEW.validation_status);
  snap_old jsonb;
  actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO occurrence_changes (occurrence_id, event_id, actor_user_id, kind, new)
    VALUES (NEW.id, NEW.event_id, actor, 'CREATE', snap_new);
  ELSE
    snap_old := jsonb_build_object(
      'status', OLD.status, 'priority', OLD.priority, 'responsible', OLD.responsible_participant_id,
      'areaId', OLD.area_id, 'teamId', OLD.team_id, 'validation', OLD.validation_status);
    IF snap_old IS DISTINCT FROM snap_new THEN
      INSERT INTO occurrence_changes (occurrence_id, event_id, actor_user_id, kind, old, new)
      VALUES (NEW.id, NEW.event_id, actor, 'UPDATE', snap_old, snap_new);
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION occurrences_outbox() FROM PUBLIC;

CREATE TRIGGER occurrences_outbox AFTER INSERT OR UPDATE ON occurrences
  FOR EACH ROW EXECUTE FUNCTION occurrences_outbox();

-- core_app: lê os próprios avisos e só marca como lido.
DROP POLICY app_insert ON notifications;
REVOKE INSERT, UPDATE ON notifications FROM core_app;
GRANT UPDATE (read_at) ON notifications TO core_app;

-- WhatsApp da própria pessoa (core_app) e no aceite do convite (core_auth).
ALTER TABLE whatsapp_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE occurrence_changes      ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON whatsapp_contacts TO core_app, core_auth;
CREATE POLICY app_self ON whatsapp_contacts TO core_app
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
CREATE POLICY auth_all ON whatsapp_contacts TO core_auth USING (true) WITH CHECK (true);
-- core_app não lê a fila nem os envios: nenhuma permissão nessas tabelas.

-- core_worker: lê o necessário para montar o aviso e grava avisos e envios.
GRANT USAGE ON SCHEMA public TO core_worker;
GRANT SELECT ON users, events, areas, teams, participants, occurrences, whatsapp_contacts TO core_worker;
GRANT SELECT, INSERT ON notifications TO core_worker;
GRANT SELECT, INSERT ON notification_deliveries TO core_worker;
GRANT UPDATE (template, status, attempts, next_attempt_at, provider_message_id, last_error, action_used_at, sent_at)
  ON notification_deliveries TO core_worker;
GRANT SELECT ON occurrence_changes TO core_worker;
GRANT UPDATE (processed_at) ON occurrence_changes TO core_worker;

CREATE POLICY worker_read ON users             FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON events            FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON areas             FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON teams             FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON participants      FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON occurrences       FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_read ON whatsapp_contacts FOR SELECT TO core_worker USING (true);
CREATE POLICY worker_all  ON notifications           TO core_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all  ON notification_deliveries TO core_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all  ON occurrence_changes      TO core_worker USING (true) WITH CHECK (true);
