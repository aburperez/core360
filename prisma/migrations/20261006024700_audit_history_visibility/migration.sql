-- O histórico de uma ocorrência é visível para quem vê a ocorrência
-- (a subconsulta em occurrences passa pela RLS dessa tabela).
CREATE POLICY app_select_occurrence_history ON audit_log FOR SELECT TO core_app USING (
  entity = 'occurrence'
  AND EXISTS (SELECT 1 FROM occurrences o WHERE o.id = audit_log.entity_id)
);
