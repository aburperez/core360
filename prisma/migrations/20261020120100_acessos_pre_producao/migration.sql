-- ═══════════════════ Hierarquia de acessos, etapa 1 (Abu, 2026-10-20) ═══════════════════
-- A Pré-produção passa a ter partes (seções). O diretor (Admin da agência) e o
-- Gerente de produção entram em todas. O Produtor executivo entra num conjunto
-- fixo. O Pré-produtor entra só nas partes marcadas para ele (producer_access).
-- Espelha src/server/authz/sections.ts e policy.ts (canUseSection).
--
-- Seções: BRIEFING, PENDENCIAS, CRONOGRAMA, MONTAGEM, TIPOS, ITENS, ORCAMENTO,
-- FINANCEIRO, COTACOES, VISITAS, DOCUMENTOS, FUNCOES, RELATORIOS, EXECUTIVO,
-- ATENDIMENTO.

-- CreateTable
CREATE TABLE "producer_access" (
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "producer_access_pkey" PRIMARY KEY ("participant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "producer_access_event_id_participant_id_key" ON "producer_access"("event_id", "participant_id");

-- AddForeignKey
ALTER TABLE "producer_access" ADD CONSTRAINT "producer_access_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_access" ADD CONSTRAINT "producer_access_event_id_participant_id_fkey" FOREIGN KEY ("event_id", "participant_id") REFERENCES "participants"("event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_access" ADD CONSTRAINT "producer_access_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────── As seções ───────────────────────────

CREATE FUNCTION app.all_sections() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['BRIEFING', 'PENDENCIAS', 'CRONOGRAMA', 'MONTAGEM', 'TIPOS', 'ITENS', 'ORCAMENTO', 'FINANCEIRO',
               'COTACOES', 'VISITAS', 'DOCUMENTOS', 'FUNCOES', 'RELATORIOS', 'EXECUTIVO', 'ATENDIMENTO']
$$;

-- O conjunto fixo do Produtor executivo: lista de produtores, financeiro,
-- orçamento, briefing do projeto, estrutura e cenografia (itens e montagem) e
-- atendimento (o que o Cliente vê e os documentos).
CREATE FUNCTION app.executive_sections() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['FUNCOES', 'ORCAMENTO', 'FINANCEIRO', 'EXECUTIVO', 'BRIEFING', 'ITENS', 'MONTAGEM',
               'DOCUMENTOS', 'ATENDIMENTO']
$$;

-- A pessoa logada entra em alguma destas partes da Pré-produção do evento?
CREATE FUNCTION app.has_section(p_event uuid, p_sections text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
      LEFT JOIN producer_access a ON a.participant_id = m.participant_id
     WHERE m.role = 'GERENTE'
        OR (m.role = 'PRODUTOR_EXECUTIVO' AND app.executive_sections() && p_sections)
        OR (m.role = 'PRE_PRODUTOR' AND a.sections && p_sections)
  )
$$;

-- Entrar na Pré-produção (ver o painel e a estrutura do evento).
CREATE OR REPLACE FUNCTION app.can_use_pre_production(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
  )
$$;

-- Marcar as caixas dos Pré-produtores: o Gerente ou o diretor.
CREATE FUNCTION app.can_grant_sections(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE'
  )
$$;

-- Pagar, lançar contratado e realizado e fechar o financeiro: o diretor, o
-- Gerente e o Produtor executivo.
CREATE FUNCTION app.can_handle_finance(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.can_close_event(p_event)
      OR EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'PRODUTOR_EXECUTIVO')
$$;

REVOKE ALL ON FUNCTION app.all_sections(), app.executive_sections(), app.has_section(uuid, text[]),
  app.can_grant_sections(uuid), app.can_handle_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.all_sections(), app.executive_sections(), app.has_section(uuid, text[]),
  app.can_grant_sections(uuid), app.can_handle_finance(uuid) TO core_app, core_worker;

-- Só Pré-produtor tem caixas, e só com seções conhecidas.
CREATE FUNCTION producer_access_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id AND p.role = 'PRE_PRODUTOR'
  ) THEN
    RAISE EXCEPTION 'as caixas de acesso valem só para Pré-produtor' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.sections <@ app.all_sections() THEN
    RAISE EXCEPTION 'parte da Pré-produção desconhecida' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.participant_id <> OLD.participant_id OR NEW.event_id <> OLD.event_id) THEN
    RAISE EXCEPTION 'não é possível mover as caixas para outra pessoa' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(DISTINCT s ORDER BY s) INTO NEW.sections FROM unnest(NEW.sections) s;
  NEW.sections := coalesce(NEW.sections, ARRAY[]::text[]);
  RETURN NEW;
END $$;

CREATE TRIGGER producer_access_check BEFORE INSERT OR UPDATE ON producer_access
  FOR EACH ROW EXECUTE FUNCTION producer_access_check();

ALTER TABLE producer_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON producer_access TO core_app;

CREATE POLICY app_select ON producer_access FOR SELECT TO core_app
  USING (app.can_use_pre_production(event_id) OR app.is_me(event_id, participant_id));
CREATE POLICY app_insert ON producer_access FOR INSERT TO core_app
  WITH CHECK (app.can_grant_sections(event_id) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON producer_access FOR UPDATE TO core_app
  USING (app.can_grant_sections(event_id))
  WITH CHECK (app.can_grant_sections(event_id) AND updated_by = app.current_user_id());

-- Ninguém perde nem ganha acesso no dia: os Pré-produtores que já existem
-- ficam com o que tinham (tudo menos Painel executivo, Fechamento financeiro e
-- Atendimento, que eram só do gestor).
CREATE FUNCTION app.legacy_producer_sections() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(s ORDER BY s) FROM unnest(app.all_sections()) s
   WHERE s NOT IN ('EXECUTIVO', 'FINANCEIRO', 'ATENDIMENTO')
$$;

INSERT INTO producer_access (participant_id, event_id, sections, updated_by, updated_at)
SELECT p.id, p.event_id, app.legacy_producer_sections(), NULL, now()
  FROM participants p
 WHERE p.role = 'PRE_PRODUTOR';

-- ─────────────────── Produtor executivo nos papéis ───────────────────

-- É do evento, não de uma área ou equipe (como o Pré-produtor).
ALTER TABLE participants DROP CONSTRAINT participants_pre_produtor_event_level;
ALTER TABLE participants
  ADD CONSTRAINT participants_pre_produtor_event_level
  CHECK (role NOT IN ('PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO') OR (area_id IS NULL AND team_id IS NULL));

-- O Gerente (e o diretor) coloca alguém como Produtor executivo.
CREATE OR REPLACE FUNCTION app.can_assign_role(p_event uuid, p_role participant_role, p_area uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE (m.role = 'GERENTE' AND p_role IN ('HEAD', 'OPERACIONAL', 'CLIENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO'))
        OR (m.role = 'HEAD'    AND p_role = 'OPERACIONAL' AND p_area = m.area_id)
  )
$$;

-- O executivo enxerga a estrutura do evento, como o Pré-produtor, e fica fora do campo.
CREATE OR REPLACE FUNCTION app.can_see_area(p_event uuid, p_area uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'HEAD', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
        OR (m.role = 'OPERACIONAL' AND m.area_id = p_area)
        OR (m.role = 'CLIENTE' AND (app.client_can(p_event, 'team') OR app.client_can(p_event, 'progress')))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_team(p_event uuid, p_area uuid, p_team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m
     WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
        OR (m.role = 'HEAD' AND m.area_id = p_area)
        OR (m.role = 'OPERACIONAL' AND m.team_id = p_team)
        OR (m.role = 'CLIENTE' AND (app.client_can(p_event, 'team') OR app.client_can(p_event, 'progress')))
  )
$$;

CREATE OR REPLACE FUNCTION app.can_see_participant(
  p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_event_admin(p_event)
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO')
            OR (m.role = 'CLIENTE' AND app.client_can(p_event, 'team'))
            OR (m.role = 'HEAD' AND (m.area_id = p_area OR p_role = 'GERENTE'))
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$$;

CREATE OR REPLACE FUNCTION app.can_use_field(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_event_admin(p_event) OR EXISTS (
    SELECT 1 FROM app.membership(p_event) m WHERE m.role NOT IN ('PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO', 'CLIENTE')
  )
$$;

-- Fornecedores da agência: o executivo vê (montagem, orçamento), não cadastra.
CREATE OR REPLACE FUNCTION app.can_see_suppliers(p_agency uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.is_agency_admin(p_agency)
      OR app.agency_role_in(p_agency, ARRAY['GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO']::participant_role[])
$$;

-- Atendimento: quem libera o que o Cliente vê.
CREATE OR REPLACE FUNCTION app.can_grant_client_view(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.has_section(p_event, ARRAY['ATENDIMENTO'])
$$;

-- Responsável geral, produtor, quem cuida da cotação e da visita: a Pré-produção.
CREATE OR REPLACE FUNCTION events_check_people() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.lead_id IS NOT NULL AND NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NOT EXISTS (
        SELECT 1 FROM participants p WHERE p.id = NEW.lead_id AND p.event_id = NEW.id
           AND p.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO') AND p.active AND p.deleted_at IS NULL))
     OR (NEW.producer_id IS NOT NULL AND NEW.producer_id IS DISTINCT FROM OLD.producer_id AND NOT EXISTS (
        SELECT 1 FROM participants p WHERE p.id = NEW.producer_id AND p.event_id = NEW.id
           AND p.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO') AND p.active AND p.deleted_at IS NULL))
  THEN
    RAISE EXCEPTION 'o responsável geral e o produtor precisam ser Gerente ou produtor do evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION quote_requests_responsible_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id
       AND p.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO') AND p.active AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Quem cuida da cotação precisa ser Gerente ou produtor do evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION technical_visits_responsible_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM participants p
     WHERE p.id = NEW.responsible_id AND p.event_id = NEW.event_id
       AND p.role IN ('GERENTE', 'PRE_PRODUTOR', 'PRODUTOR_EXECUTIVO') AND p.active AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Quem vai à visita técnica precisa ser Gerente ou produtor do evento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- ───────────────────── Financeiro: o executivo também ─────────────────────

DROP POLICY app_insert ON event_finances;
DROP POLICY app_update ON event_finances;
CREATE POLICY app_insert ON event_finances FOR INSERT TO core_app
  WITH CHECK ((app.can_review_sla(event_id) OR app.can_handle_finance(event_id)) AND updated_by = app.current_user_id());
CREATE POLICY app_update ON event_finances FOR UPDATE TO core_app
  USING (app.can_review_sla(event_id) OR app.can_handle_finance(event_id))
  WITH CHECK ((app.can_review_sla(event_id) OR app.can_handle_finance(event_id)) AND updated_by = app.current_user_id());

-- ─────────────── Cada regra da Pré-produção passa a olhar a sua parte ───────────────
-- Troca app.can_use_pre_production(x) por app.has_section(x, ARRAY[...]) nas
-- regras (policies) e funções abaixo. Leitura (SELECT) e escrita podem pedir
-- partes diferentes: quem só lê uma tabela de apoio (os itens, para a
-- cotação) continua lendo. Tabela fora da lista mantém a regra antiga
-- (qualquer pessoa da Pré-produção lê).

CREATE TEMP TABLE section_map (tbl text, cmd text, sections text[]) ON COMMIT DROP;
INSERT INTO section_map VALUES
  -- Produtores e Funções: funções, atividades, briefing de cada pessoa e a ficha.
  ('activities',            'WRITE',  ARRAY['FUNCOES']),
  ('briefings',             'ALL',    ARRAY['FUNCOES']),
  ('event_functions',       'WRITE',  ARRAY['FUNCOES']),
  ('participant_profiles',  'ALL',    ARRAY['FUNCOES']),
  -- Mapa de montagem.
  ('arrivals',              'WRITE',  ARRAY['MONTAGEM']),
  ('arrival_items',         'WRITE',  ARRAY['MONTAGEM']),
  -- Cotações, propostas e contratos.
  ('quote_requests',        'WRITE',  ARRAY['COTACOES']),
  ('supplier_quotes',       'WRITE',  ARRAY['COTACOES']),
  ('contracts',             'WRITE',  ARRAY['COTACOES']),
  ('contracts',             'SELECT', ARRAY['COTACOES', 'FINANCEIRO', 'EXECUTIVO', 'DOCUMENTOS', 'PENDENCIAS', 'RELATORIOS']),
  ('contract_items',        'ALL',    ARRAY['COTACOES']),
  -- Itens e orçamento (a cotação grava o contratado; o financeiro, o pagamento).
  ('cost_sheets',           'WRITE',  ARRAY['ITENS', 'ORCAMENTO']),
  ('cost_sections',         'WRITE',  ARRAY['ITENS', 'ORCAMENTO']),
  ('cost_items',            'INSERT', ARRAY['ITENS', 'ORCAMENTO']),
  ('cost_items',            'DELETE', ARRAY['ITENS', 'ORCAMENTO']),
  ('cost_items',            'UPDATE', ARRAY['ITENS', 'ORCAMENTO', 'FINANCEIRO', 'COTACOES']),
  -- Briefing do evento.
  ('event_briefings',       'WRITE',  ARRAY['BRIEFING']),
  ('event_briefings',       'SELECT', ARRAY['BRIEFING', 'RELATORIOS']),
  ('event_briefing_fronts', 'WRITE',  ARRAY['BRIEFING']),
  ('event_briefing_fronts', 'SELECT', ARRAY['BRIEFING', 'RELATORIOS']),
  -- Documentos.
  ('event_documents',       'ALL',    ARRAY['DOCUMENTOS']),
  -- Cronograma e pendências.
  ('event_milestones',      'WRITE',  ARRAY['CRONOGRAMA']),
  ('event_milestones',      'SELECT', ARRAY['CRONOGRAMA', 'PENDENCIAS', 'RELATORIOS']),
  ('event_tasks',           'ALL',    ARRAY['PENDENCIAS']),
  -- Tipos e SLA.
  ('service_types',         'WRITE',  ARRAY['TIPOS']),
  ('service_type_people',   'WRITE',  ARRAY['TIPOS']),
  ('sla_proposals',         'WRITE',  ARRAY['TIPOS']),
  -- Visitas técnicas.
  ('technical_visits',      'ALL',    ARRAY['VISITAS']),
  ('technical_visit_photos','ALL',    ARRAY['VISITAS']);

DO $$
DECLARE
  r record;
  v_sections text[];
  v_using text;
  v_check text;
  v_sql text;
  v_left int;
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname, p.cmd, p.qual, p.with_check
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND (p.qual LIKE '%can_use_pre_production%' OR p.with_check LIKE '%can_use_pre_production%')
  LOOP
    SELECT m.sections INTO v_sections
      FROM section_map m
     WHERE m.tbl = r.tablename
       AND (m.cmd = r.cmd
         OR m.cmd = 'ALL'
         OR (m.cmd = 'WRITE' AND r.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')))
     ORDER BY CASE WHEN m.cmd = r.cmd THEN 0 WHEN m.cmd = 'WRITE' THEN 1 ELSE 2 END
     LIMIT 1;
    CONTINUE WHEN v_sections IS NULL;

    v_using := regexp_replace(r.qual, 'app\.can_use_pre_production\(([^()]*)\)',
                              'app.has_section(\1, ' || quote_literal(v_sections::text) || '::text[])', 'g');
    v_check := regexp_replace(r.with_check, 'app\.can_use_pre_production\(([^()]*)\)',
                              'app.has_section(\1, ' || quote_literal(v_sections::text) || '::text[])', 'g');
    v_sql := format('ALTER POLICY %I ON %I', r.policyname, r.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_using || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;

  -- Toda escrita da Pré-produção tem que ter ficado com a sua parte.
  SELECT count(*) INTO v_left FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.cmd <> 'SELECT'
     AND (p.qual LIKE '%can_use_pre_production%' OR p.with_check LIKE '%can_use_pre_production%');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'faltou ligar % regra(s) de escrita da Pré-produção a uma parte', v_left;
  END IF;
END $$;

-- Funções que decidiam pela Pré-produção inteira.
CREATE TEMP TABLE section_fn_map (fn regprocedure, sections text[]) ON COMMIT DROP;
INSERT INTO section_fn_map VALUES
  ('app.can_edit_visit(uuid,uuid,uuid)'::regprocedure, ARRAY['VISITAS']),
  ('app.can_give_function(uuid,uuid)'::regprocedure,   ARRAY['FUNCOES']),
  ('app.can_give_functions(uuid)'::regprocedure,       ARRAY['FUNCOES']),
  ('app.can_see_arrival(uuid,uuid,uuid)'::regprocedure,     ARRAY['MONTAGEM']),
  ('app.create_default_milestones(uuid)'::regprocedure, ARRAY['CRONOGRAMA']),
  ('app.notify_quote(uuid,text)'::regprocedure,        ARRAY['COTACOES']),
  ('app.report_occurrences(uuid)'::regprocedure,       ARRAY['RELATORIOS']),
  ('public.arrivals_guard()'::regprocedure,            ARRAY['MONTAGEM']),
  ('public.briefings_guard()'::regprocedure,           ARRAY['FUNCOES']);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT fn, sections FROM section_fn_map LOOP
    EXECUTE regexp_replace(pg_get_functiondef(r.fn), 'app\.can_use_pre_production\(([^()]*)\)',
                           'app.has_section(\1, ' || quote_literal(r.sections::text) || '::text[])', 'g');
  END LOOP;
END $$;

-- O executivo paga, lança contratado e realizado e fecha o financeiro.
DO $$
BEGIN
  EXECUTE replace(pg_get_functiondef('public.cost_items_finance_lock()'::regprocedure),
                  'app.can_close_event(', 'app.can_handle_finance(');
  EXECUTE replace(pg_get_functiondef('public.event_finances_close_guard()'::regprocedure),
                  'app.can_close_event(', 'app.can_handle_finance(');
  EXECUTE replace(pg_get_functiondef('public.cost_items_guard()'::regprocedure),
                  'IF NEW.contracted_value IS DISTINCT FROM OLD.contracted_value OR NEW.actual_value IS DISTINCT FROM OLD.actual_value THEN',
                  'IF (NEW.contracted_value IS DISTINCT FROM OLD.contracted_value OR NEW.actual_value IS DISTINCT FROM OLD.actual_value)'
                  || ' AND NOT app.can_handle_finance(NEW.event_id) THEN');
END $$;
