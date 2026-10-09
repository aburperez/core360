-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'HISTORICO';

-- CreateTable
CREATE TABLE "event_archives" (
    "event_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "concluded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "history_downloaded_at" TIMESTAMPTZ(3),
    "history_downloaded_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "summary" JSONB,

    CONSTRAINT "event_archives_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "event_archives_agency_id_closed_at_idx" ON "event_archives"("agency_id", "closed_at");

-- AddForeignKey
ALTER TABLE "event_archives" ADD CONSTRAINT "event_archives_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_archives" ADD CONSTRAINT "event_archives_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_archives" ADD CONSTRAINT "event_archives_history_downloaded_by_fkey" FOREIGN KEY ("history_downloaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_archives" ADD CONSTRAINT "event_archives_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────── Fase 6C: histórico e encerramento ───────────────────────
-- Concluído: o diretor baixa o histórico. Encerrar: o banco apaga fotos,
-- arquivos e pessoas do evento e guarda só o resumo. Nada se apaga sozinho.

-- Encerrado: o evento não muda mais e ninguém mais trabalha nele.
CREATE FUNCTION app.event_closed(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM event_archives WHERE event_id = p_event AND closed_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION app.event_closed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_closed(uuid) TO core_app, core_auth;

-- Admin da agência deixa de "poder tudo" num evento encerrado (as participações
-- já foram apagadas, então ninguém mais entra nele).
CREATE OR REPLACE FUNCTION app.is_event_admin(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event AND e.agency_id IN (SELECT app.admin_agencies())
       AND NOT EXISTS (SELECT 1 FROM event_archives a WHERE a.event_id = e.id AND a.closed_at IS NOT NULL)
  )
$$;

-- Diretor do evento para o encerramento: Gerente do evento ou Admin de verdade
-- da agência (o Suporte não encerra).
CREATE FUNCTION app.can_close_event(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event AND app.is_agency_full_admin(e.agency_id))
      OR EXISTS (SELECT 1 FROM app.membership(p_event) m WHERE m.role = 'GERENTE')
$$;
REVOKE ALL ON FUNCTION app.can_close_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_close_event(uuid) TO core_app;

ALTER TABLE event_archives ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON event_archives TO core_app;
-- Quem trabalha no evento vê o andamento; depois de encerrado, o Admin e os
-- diretores da agência veem o resumo.
CREATE POLICY app_select ON event_archives FOR SELECT TO core_app USING (
  app.can_see_event(event_id) OR app.is_agency_admin(agency_id) OR app.is_agency_director(agency_id)
);

-- Avisa os Gerentes (os diretores entram como Gerente) para baixar o histórico.
CREATE FUNCTION notify_history(p_event uuid, p_round integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev events%ROWTYPE;
  v_n integer := 0;
BEGIN
  SELECT * INTO ev FROM events WHERE id = p_event;
  INSERT INTO notifications (id, user_id, event_id, type, title, body, dedupe_key, link)
  SELECT gen_random_uuid(), p.user_id, p_event, 'HISTORICO',
         CASE WHEN p_round = 0 THEN 'Evento concluído: baixe o histórico'
              ELSE 'Lembrete: o histórico do evento ainda não foi baixado' END,
         ev.name, 'history:' || p_event || ':' || p_round,
         '/eventos/' || p_event || '/encerramento'
    FROM participants p
    JOIN users u ON u.id = p.user_id AND u.active
   WHERE p.event_id = p_event AND p.active AND p.deleted_at IS NULL AND p.role = 'GERENTE'
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION notify_history(uuid, integer) FROM PUBLIC;

-- Concluído abre o encerramento; voltar de Concluído desfaz (se ainda não encerrou).
CREATE FUNCTION events_archive_on_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'CONCLUIDO' AND OLD.status <> 'CONCLUIDO' THEN
    INSERT INTO event_archives (event_id, agency_id) VALUES (NEW.id, NEW.agency_id)
    ON CONFLICT (event_id) DO UPDATE SET concluded_at = CURRENT_TIMESTAMP, history_downloaded_at = NULL, history_downloaded_by = NULL;
    PERFORM notify_history(NEW.id, 0);
  ELSIF OLD.status = 'CONCLUIDO' AND NEW.status <> 'CONCLUIDO' THEN
    DELETE FROM event_archives WHERE event_id = NEW.id AND closed_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER events_archive_on_status AFTER UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION events_archive_on_status();

-- Evento encerrado não muda mais (nem de etapa).
CREATE FUNCTION events_closed_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app.event_closed(OLD.id) THEN
    RAISE EXCEPTION 'Evento encerrado não muda mais' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER events_closed_guard BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_closed_guard();

-- Lembrete semanal enquanto o histórico não foi baixado (o despacho chama).
CREATE FUNCTION history_reminders(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a record;
  v_n integer := 0;
BEGIN
  FOR a IN
    SELECT event_id, floor(extract(epoch FROM p_now - concluded_at) / 604800)::integer AS round
      FROM event_archives
     WHERE closed_at IS NULL AND history_downloaded_at IS NULL AND concluded_at <= p_now - interval '7 days'
  LOOP
    v_n := v_n + notify_history(a.event_id, a.round);
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION history_reminders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION history_reminders(timestamptz) TO core_worker;

-- O diretor baixou o histórico (a primeira vez fica registrada).
CREATE FUNCTION app.mark_history_downloaded(p_event uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app.current_user_id() IS NULL OR NOT app.can_close_event(p_event) THEN
    RAISE EXCEPTION 'Evento não encontrado' USING ERRCODE = '42501';
  END IF;
  UPDATE event_archives
     SET history_downloaded_at = COALESCE(history_downloaded_at, CURRENT_TIMESTAMP),
         history_downloaded_by = COALESCE(history_downloaded_by, app.current_user_id())
   WHERE event_id = p_event AND closed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O evento ainda não foi concluído' USING ERRCODE = '23514';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app.mark_history_downloaded(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_history_downloaded(uuid) TO core_app;

-- A escolha do orçamento aponta para a proposta e a proposta para a cotação:
-- no encerramento as duas saem juntas.
ALTER TABLE quote_requests ALTER CONSTRAINT quote_requests_id_chosen_quote_id_fkey DEFERRABLE INITIALLY IMMEDIATE;

-- A visita concluída e as fotos dela não se apagam, a não ser no encerramento.
CREATE OR REPLACE FUNCTION technical_visits_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  photos int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CONCLUIDA' AND NOT app.event_closed(OLD.event_id) THEN
      RAISE EXCEPTION 'reabra a visita antes de apagar' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a visita não muda de evento nem de quem marcou' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CONCLUIDA' AND NEW.status = 'CONCLUIDA'
     AND (NEW.title, NEW.place, NEW.scheduled_at, NEW.responsible_id, NEW.ppe, NEW.ppe_other, NEW.notes, NEW.address,
          NEW.people, NEW.access_text, NEW.power_text, NEW.internet_text, NEW.facilities_text, NEW.restrictions_text,
          NEW.contacts_text, NEW.observations, NEW.concluded_at)
         IS DISTINCT FROM
         (OLD.title, OLD.place, OLD.scheduled_at, OLD.responsible_id, OLD.ppe, OLD.ppe_other, OLD.notes, OLD.address,
          OLD.people, OLD.access_text, OLD.power_text, OLD.internet_text, OLD.facilities_text, OLD.restrictions_text,
          OLD.contacts_text, OLD.observations, OLD.concluded_at)
  THEN
    RAISE EXCEPTION 'visita concluída: reabra para mudar' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CONCLUIDA' AND OLD.status <> 'CONCLUIDA' THEN
    SELECT count(*) INTO photos FROM technical_visit_photos WHERE visit_id = NEW.id;
    IF photos < 10 THEN
      RAISE EXCEPTION 'a visita precisa de pelo menos 10 fotos (tem %)', photos USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION technical_visit_photos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v technical_visits%ROWTYPE;
  photos int;
BEGIN
  IF TG_OP = 'DELETE' AND app.event_closed(OLD.event_id) THEN RETURN OLD; END IF;
  SELECT * INTO v FROM technical_visits WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.visit_id ELSE NEW.visit_id END) FOR UPDATE;
  -- Apagando a visita inteira (cascata): a visita já saiu.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'visita não encontrada' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v.status = 'CONCLUIDA' THEN
    RAISE EXCEPTION 'visita concluída: reabra para mudar as fotos' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.event_id, NEW.visit_id, NEW.storage_key, NEW.mime_type, NEW.size_bytes, NEW.sha256, NEW.uploaded_by)
     IS DISTINCT FROM (OLD.event_id, OLD.visit_id, OLD.storage_key, OLD.mime_type, OLD.size_bytes, OLD.sha256, OLD.uploaded_by)
  THEN
    RAISE EXCEPTION 'da foto só mudam a legenda e a ordem' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO photos FROM technical_visit_photos WHERE visit_id = NEW.visit_id;
    IF photos >= 40 THEN
      RAISE EXCEPTION 'no máximo 40 fotos por visita' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION event_documents_contract_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.visible_to_field AND EXISTS (SELECT 1 FROM contracts WHERE document_id = NEW.id) THEN
    RAISE EXCEPTION 'O PDF de contrato não é liberado para o campo' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND NOT app.event_closed(OLD.event_id)
     AND EXISTS (SELECT 1 FROM contracts WHERE document_id = OLD.id AND status IN ('ENVIADO', 'ASSINADO')) THEN
    RAISE EXCEPTION 'Este é o PDF de um contrato enviado ou assinado e não pode ser apagado' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Encerrar e apagar. Confere tudo de novo aqui (diretor, Concluído, histórico
-- baixado e o nome digitado), guarda o resumo e apaga o resto do evento.
-- Devolve as chaves dos arquivos para o app apagar do armazenamento.
CREATE FUNCTION app.close_event(p_event uuid, p_confirm text, p_summary jsonb) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me  uuid := app.current_user_id();
  ev    events%ROWTYPE;
  ar    event_archives%ROWTYPE;
  v_keys text[];
BEGIN
  SELECT * INTO ev FROM events WHERE id = p_event AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR NOT app.can_close_event(p_event) THEN
    RAISE EXCEPTION 'Evento não encontrado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ar FROM event_archives WHERE event_id = p_event FOR UPDATE;
  IF ev.status <> 'CONCLUIDO' OR NOT FOUND OR ar.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só um evento concluído (e ainda não encerrado) pode ser encerrado' USING ERRCODE = '23514';
  END IF;
  IF ar.history_downloaded_at IS NULL THEN
    RAISE EXCEPTION 'Baixe o histórico do evento antes de encerrar' USING ERRCODE = '23514';
  END IF;
  IF lower(btrim(coalesce(p_confirm, ''))) <> lower(btrim(ev.name)) THEN
    RAISE EXCEPTION 'Digite o nome do evento exatamente como aparece' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT storage_key AS k FROM attachments WHERE event_id = p_event
    UNION ALL SELECT storage_key FROM receipt_photos WHERE event_id = p_event
    UNION ALL SELECT storage_key FROM floor_plans WHERE event_id = p_event
    UNION ALL SELECT storage_key FROM plan_point_photos WHERE event_id = p_event
    UNION ALL SELECT storage_key FROM technical_visit_photos WHERE event_id = p_event
    UNION ALL SELECT storage_key FROM event_documents WHERE event_id = p_event
    UNION ALL SELECT file_key FROM supplier_quotes WHERE event_id = p_event AND file_key IS NOT NULL
  ) f;

  -- O que fica no evento: nome, datas, cliente e local. Sai quem cuidava.
  UPDATE events SET lead_id = NULL, producer_id = NULL, description = NULL WHERE id = p_event;
  UPDATE event_archives
     SET closed_at = CURRENT_TIMESTAMP, closed_by = v_me, summary = p_summary
   WHERE event_id = p_event;

  UPDATE teams SET leader_participant_id = NULL WHERE event_id = p_event;
  SET CONSTRAINTS quote_requests_id_chosen_quote_id_fkey DEFERRED;

  -- Na ordem das chaves estrangeiras (quem aponta sai antes).
  DELETE FROM activity_checks WHERE event_id = p_event;
  DELETE FROM activities WHERE event_id = p_event;
  DELETE FROM arrival_items WHERE arrival_id IN (SELECT id FROM arrivals WHERE event_id = p_event);
  DELETE FROM arrivals WHERE event_id = p_event;
  DELETE FROM attachments WHERE event_id = p_event;
  DELETE FROM briefings WHERE event_id = p_event;
  DELETE FROM client_views WHERE event_id = p_event;
  DELETE FROM contract_items WHERE contract_id IN (SELECT id FROM contracts WHERE event_id = p_event);
  DELETE FROM contracts WHERE event_id = p_event;
  DELETE FROM cost_sheets WHERE event_id = p_event;
  DELETE FROM daily_notes WHERE event_id = p_event;
  DELETE FROM event_briefing_fronts WHERE event_id = p_event;
  DELETE FROM event_briefings WHERE event_id = p_event;
  DELETE FROM event_documents WHERE event_id = p_event;
  DELETE FROM event_finances WHERE event_id = p_event;
  DELETE FROM event_milestones WHERE event_id = p_event;
  DELETE FROM event_tasks WHERE event_id = p_event;
  DELETE FROM floor_plans WHERE event_id = p_event;
  DELETE FROM invitations WHERE event_id = p_event;
  DELETE FROM receipt_photos WHERE event_id = p_event;
  DELETE FROM item_receipts WHERE event_id = p_event;
  DELETE FROM notifications WHERE event_id = p_event;
  DELETE FROM occurrence_changes WHERE event_id = p_event;
  DELETE FROM participant_profiles WHERE event_id = p_event;
  DELETE FROM plan_point_photos WHERE event_id = p_event;
  DELETE FROM plan_points WHERE event_id = p_event;
  DELETE FROM service_type_people WHERE event_id = p_event;
  DELETE FROM sla_policies WHERE event_id = p_event;
  DELETE FROM sla_proposals WHERE event_id = p_event;
  DELETE FROM technical_visit_photos WHERE event_id = p_event;
  DELETE FROM technical_visits WHERE event_id = p_event;
  DELETE FROM supplier_quotes WHERE event_id = p_event;
  DELETE FROM quote_requests WHERE event_id = p_event;
  DELETE FROM cost_items WHERE event_id = p_event;
  DELETE FROM cost_sections WHERE event_id = p_event;
  DELETE FROM event_functions WHERE event_id = p_event;
  DELETE FROM occurrences WHERE event_id = p_event;
  DELETE FROM service_types WHERE event_id = p_event;
  DELETE FROM participants WHERE event_id = p_event;
  DELETE FROM teams WHERE event_id = p_event;
  DELETE FROM areas WHERE event_id = p_event;

  -- Fotos guardadas no próprio banco (no armazenamento externo o app apaga).
  DELETE FROM stored_files WHERE key = ANY (v_keys);
  RETURN v_keys;
END $$;
REVOKE ALL ON FUNCTION app.close_event(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_event(uuid, text, jsonb) TO core_app;
