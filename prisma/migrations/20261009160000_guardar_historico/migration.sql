-- Abu (2026-10-09 14:45): o evento concluído fica guardado no sistema com
-- todos os arquivos. Só sai em "Encerrar e excluir", e baixar a cópia para
-- arquivar é opcional. Por isso: o aviso de Concluído muda, o lembrete
-- semanal acaba e o encerramento não exige mais o histórico baixado.
-- O resumo de quem for excluído passa a guardar os preços dos itens (o app
-- monta o JSON; nada muda na tabela).

-- Um aviso só, ao concluir (p_round fica para não mudar quem chama).
CREATE OR REPLACE FUNCTION notify_history(p_event uuid, p_round integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev events%ROWTYPE;
  v_n integer := 0;
BEGIN
  SELECT * INTO ev FROM events WHERE id = p_event;
  INSERT INTO notifications (id, user_id, event_id, type, title, body, dedupe_key, link)
  SELECT gen_random_uuid(), p.user_id, p_event, 'HISTORICO',
         'Evento concluído: o histórico fica guardado',
         ev.name, 'history:' || p_event || ':' || p_round,
         '/eventos/' || p_event || '/encerramento'
    FROM participants p
    JOIN users u ON u.id = p.user_id AND u.active
   WHERE p.event_id = p_event AND p.active AND p.deleted_at IS NULL AND p.role = 'GERENTE'
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

DROP FUNCTION history_reminders(timestamptz);

-- Encerrar e excluir: confere diretor, Concluído e o nome digitado (sem exigir o download).
CREATE OR REPLACE FUNCTION app.close_event(p_event uuid, p_confirm text, p_summary jsonb) RETURNS text[]
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
