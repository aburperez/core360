-- CORE 360 — regras que o banco garante sozinho, independentemente do código.
-- (O Prisma não expressa CHECKs, índices parciais/de expressão nem triggers.)
--
-- Pré-requisito: o papel "core_app" já existe (ver docker/init-roles.sql).

-- ───────────────────────── CHECKs ─────────────────────────

ALTER TABLE clients
  ADD CONSTRAINT clients_name_not_blank CHECK (btrim(name) <> '');

ALTER TABLE events
  ADD CONSTRAINT events_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT events_dates_order CHECK (ends_at >= starts_at),
  ADD CONSTRAINT events_occurrence_seq_non_negative CHECK (occurrence_seq >= 0);

ALTER TABLE areas
  ADD CONSTRAINT areas_name_not_blank CHECK (btrim(name) <> '');

ALTER TABLE teams
  ADD CONSTRAINT teams_name_not_blank CHECK (btrim(name) <> '');

ALTER TABLE participants
  ADD CONSTRAINT participants_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT participants_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- FK composta com coluna nula não é verificada (MATCH SIMPLE); por isso
  -- equipe sem área é proibida explicitamente.
  ADD CONSTRAINT participants_team_requires_area CHECK (team_id IS NULL OR area_id IS NOT NULL),
  ADD CONSTRAINT participants_head_requires_area CHECK (role <> 'HEAD' OR area_id IS NOT NULL),
  ADD CONSTRAINT participants_operacional_requires_team
    CHECK (role <> 'OPERACIONAL' OR (area_id IS NOT NULL AND team_id IS NOT NULL));

ALTER TABLE occurrences
  ADD CONSTRAINT occurrences_title_not_blank CHECK (btrim(title) <> ''),
  ADD CONSTRAINT occurrences_concluded_consistency
    CHECK ((status = 'CONCLUIDO') = (concluded_at IS NOT NULL)),
  ADD CONSTRAINT occurrences_concluded_by_consistency
    CHECK ((concluded_at IS NULL) = (concluded_by IS NULL)),
  ADD CONSTRAINT occurrences_concluded_after_opened
    CHECK (concluded_at IS NULL OR concluded_at >= opened_at),
  ADD CONSTRAINT occurrences_validation_consistency
    CHECK ((validation_status = 'PENDENTE') = (validated_at IS NULL)
       AND (validated_at IS NULL) = (validated_by IS NULL)),
  ADD CONSTRAINT occurrences_version_positive CHECK (version >= 1);

ALTER TABLE attachments
  ADD CONSTRAINT attachments_size_positive CHECK (size_bytes > 0),
  ADD CONSTRAINT attachments_image_only CHECK (mime_type LIKE 'image/%'),
  ADD CONSTRAINT attachments_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_target_positive CHECK (target_minutes > 0);

-- ─────────────────── Índices parciais e de expressão ───────────────────

CREATE UNIQUE INDEX clients_document_unique
  ON clients (document) WHERE document IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX areas_event_name_unique
  ON areas (event_id, lower(name)) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX teams_area_name_unique
  ON teams (area_id, lower(name)) WHERE deleted_at IS NULL;

-- Uma participação por usuário por evento.
CREATE UNIQUE INDEX participants_event_user_unique
  ON participants (event_id, user_id) WHERE user_id IS NOT NULL;

-- Índice usado em TODA checagem de acesso.
CREATE INDEX participants_access_lookup
  ON participants (user_id, event_id) WHERE active AND deleted_at IS NULL;

-- Varredura do job de SLA (só chamados abertos).
CREATE INDEX occurrences_open_sla_due
  ON occurrences (sla_due_at) WHERE status NOT IN ('CONCLUIDO', 'CANCELADO');

-- ─────────────────────── Triggers de ocorrências ───────────────────────

-- Na criação: número curto sequencial por evento e cliente copiado do evento.
-- SECURITY DEFINER porque o usuário que abre o chamado não pode alterar "events".
CREATE FUNCTION occurrences_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_client_id uuid;
  v_seq int;
BEGIN
  UPDATE events
     SET occurrence_seq = occurrence_seq + 1
   WHERE id = NEW.event_id
  RETURNING client_id, occurrence_seq INTO v_client_id, v_seq;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'evento % não existe', NEW.event_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.client_id := v_client_id;
  NEW.number := v_seq;
  NEW.version := 1;
  RETURN NEW;
END $$;

CREATE TRIGGER occurrences_before_insert
  BEFORE INSERT ON occurrences
  FOR EACH ROW EXECUTE FUNCTION occurrences_before_insert();

-- Na edição: campos de identidade/origem são imutáveis e a versão sobe sozinha.
CREATE FUNCTION occurrences_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.event_id <> OLD.event_id
     OR NEW.client_id <> OLD.client_id
     OR NEW.number <> OLD.number
     OR NEW.created_by <> OLD.created_by
     OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION 'campos de origem da ocorrência não podem ser alterados'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE TRIGGER occurrences_before_update
  BEFORE UPDATE ON occurrences
  FOR EACH ROW EXECUTE FUNCTION occurrences_before_update();

-- SLA: duração e estouro calculados pelo banco a partir dos horários,
-- nunca aceitos do navegador. (Nome com "z" para rodar depois dos anteriores.)
CREATE FUNCTION occurrences_compute_sla() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.concluded_at IS NULL THEN
    NEW.duration_seconds := NULL;
    NEW.sla_breached := CASE
      WHEN NEW.sla_due_at IS NOT NULL AND NEW.sla_due_at < now() THEN true
      ELSE NULL END;
  ELSE
    NEW.duration_seconds := floor(extract(epoch FROM NEW.concluded_at - NEW.opened_at))::int;
    NEW.sla_breached := NEW.sla_due_at IS NOT NULL AND NEW.concluded_at > NEW.sla_due_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER occurrences_z_compute_sla
  BEFORE INSERT OR UPDATE ON occurrences
  FOR EACH ROW EXECUTE FUNCTION occurrences_compute_sla();

-- ─────────────────────── Auditoria imutável ───────────────────────

CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log é somente inclusão (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- ─────────────────────── Permissões do papel da aplicação ───────────────────────
-- core_app não é dono de nada: lê e grava, mas não apaga dados de negócio
-- (exclusão é lógica, via deleted_at) e não altera a auditoria.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION occurrences_before_insert() FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO core_app;

GRANT SELECT, INSERT, UPDATE ON
  users, clients, events, areas, teams, participants,
  occurrences, attachments, sla_policies, notifications
TO core_app;

-- Tabelas de sessão do Better Auth: logout e expiração apagam linhas.
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications TO core_app;

GRANT SELECT, INSERT ON audit_log TO core_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO core_app;
