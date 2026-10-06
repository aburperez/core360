-- Pré-produção, etapa 3: planilha de custos (orçamento) do evento, no
-- formato da matriz de orçamento que a equipe já usa. Só a Pré-produção
-- (Gerente, Pré-produtor e Admin) vê e edita, como os tipos de atendimento.

-- CreateEnum
CREATE TYPE "cost_billing" AS ENUM ('FATURA', 'NOTA_FISCAL', 'DIRETO');

-- CreateTable
CREATE TABLE "cost_sheets" (
    "event_id" UUID NOT NULL,
    "title" TEXT,
    "client_name" TEXT,
    "project_name" TEXT,
    "period" TEXT,
    "client_payment_terms" TEXT,
    "author" TEXT,
    "fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "invoice_tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 9.5,
    "nf_tax_pct" DECIMAL(5,2) NOT NULL DEFAULT 17.5,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_sheets_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "cost_sections" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payment_terms" TEXT,
    "unit_value" DECIMAL(14,2) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "frequency" DECIMAL(12,3),
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "billing" "cost_billing" NOT NULL DEFAULT 'FATURA',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_sections_event_id_position_idx" ON "cost_sections"("event_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "cost_sections_event_id_id_key" ON "cost_sections"("event_id", "id");

-- CreateIndex
CREATE INDEX "cost_items_event_id_section_id_position_idx" ON "cost_items"("event_id", "section_id", "position");

-- AddForeignKey
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_sections" ADD CONSTRAINT "cost_sections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_event_id_section_id_fkey" FOREIGN KEY ("event_id", "section_id") REFERENCES "cost_sections"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────── Regras de dados ───────────────────────────

ALTER TABLE cost_sheets
  ADD CONSTRAINT cost_sheets_fee_pct_range CHECK (fee_pct >= 0 AND fee_pct <= 100),
  -- Encargo "por dentro" divide por (1 - %): 100% não existe.
  ADD CONSTRAINT cost_sheets_invoice_tax_range CHECK (invoice_tax_pct >= 0 AND invoice_tax_pct < 100),
  ADD CONSTRAINT cost_sheets_nf_tax_range CHECK (nf_tax_pct >= 0 AND nf_tax_pct < 100);

ALTER TABLE cost_sections
  ADD CONSTRAINT cost_sections_name_not_blank CHECK (btrim(name) <> '');

ALTER TABLE cost_items
  ADD CONSTRAINT cost_items_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT cost_items_unit_value_nonneg CHECK (unit_value >= 0),
  ADD CONSTRAINT cost_items_quantity_nonneg CHECK (quantity >= 0),
  ADD CONSTRAINT cost_items_frequency_nonneg CHECK (frequency IS NULL OR frequency >= 0);

-- ─────────────────────────────── Acesso ───────────────────────────────

ALTER TABLE cost_sheets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_items    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cost_sheets, cost_sections, cost_items FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON cost_sheets TO core_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cost_sections, cost_items TO core_app;

CREATE POLICY app_select ON cost_sheets FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON cost_sheets FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_update ON cost_sheets FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));

CREATE POLICY app_select ON cost_sections FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON cost_sections FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_update ON cost_sections FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON cost_sections FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));

CREATE POLICY app_select ON cost_items FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id));
CREATE POLICY app_insert ON cost_items FOR INSERT TO core_app
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_update ON cost_items FOR UPDATE TO core_app
  USING (app.can_use_pre_production(event_id))
  WITH CHECK (app.can_use_pre_production(event_id));
CREATE POLICY app_delete ON cost_items FOR DELETE TO core_app
  USING (app.can_use_pre_production(event_id));
