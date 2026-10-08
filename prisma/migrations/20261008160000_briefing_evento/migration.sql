-- Briefing do evento (Pré-produção): cliente, evento, local e as 13 frentes de
-- estrutura, cada uma com "precisa" e observação. Nome, tipo, público estimado,
-- local e endereço continuam na ficha do evento (uma fonte só). Só a
-- Pré-produção (Gerente, Pré-produtor e Admin) vê e preenche.

-- CreateEnum
CREATE TYPE "briefing_front" AS ENUM ('CENOGRAFIA', 'INFRAESTRUTURA', 'AUDIO', 'VIDEO', 'ILUMINACAO', 'MOBILIARIO', 'CREDENCIAMENTO', 'SEGURANCA', 'LIMPEZA', 'ALIMENTACAO', 'STAFF', 'TRANSPORTE', 'LOGISTICA');

-- CreateTable
CREATE TABLE "event_briefings" (
    "event_id" UUID NOT NULL,
    "client_company" TEXT,
    "client_agency" TEXT,
    "client_contact" TEXT,
    "client_responsible" TEXT,
    "objective" TEXT,
    "concept" TEXT,
    "audience_profile" TEXT,
    "venue_contacts" TEXT,
    "allowed_hours" TEXT,
    "venue_rules" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_briefings_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_briefing_fronts" (
    "event_id" UUID NOT NULL,
    "front" "briefing_front" NOT NULL,
    "needed" BOOLEAN,
    "notes" TEXT,

    CONSTRAINT "event_briefing_fronts_pkey" PRIMARY KEY ("event_id","front")
);

-- AddForeignKey
ALTER TABLE "event_briefings" ADD CONSTRAINT "event_briefings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_briefing_fronts" ADD CONSTRAINT "event_briefing_fronts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE event_briefings
  ADD CONSTRAINT event_briefings_sizes CHECK (
        coalesce(length(client_company), 0) <= 200 AND coalesce(length(client_agency), 0) <= 200
    AND coalesce(length(client_contact), 0) <= 500 AND coalesce(length(client_responsible), 0) <= 200
    AND coalesce(length(objective), 0) <= 4000 AND coalesce(length(concept), 0) <= 4000
    AND coalesce(length(audience_profile), 0) <= 2000 AND coalesce(length(venue_contacts), 0) <= 2000
    AND coalesce(length(allowed_hours), 0) <= 2000 AND coalesce(length(venue_rules), 0) <= 4000);

ALTER TABLE event_briefing_fronts
  ADD CONSTRAINT event_briefing_fronts_notes_size CHECK (coalesce(length(notes), 0) <= 2000);

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE event_briefings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_briefings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON event_briefings TO core_app;

CREATE POLICY app_select ON event_briefings FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON event_briefings FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON event_briefings FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id) AND updated_by = app.current_user_id());

ALTER TABLE event_briefing_fronts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_briefing_fronts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON event_briefing_fronts TO core_app;

CREATE POLICY app_select ON event_briefing_fronts FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON event_briefing_fronts FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_update ON event_briefing_fronts FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));
