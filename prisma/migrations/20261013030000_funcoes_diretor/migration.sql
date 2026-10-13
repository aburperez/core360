-- Produtores e Funções (Abu, 2026-10-13): no painel do diretor de produção,
-- botões para alterar e excluir cada função. Mudar o nome ou excluir uma
-- função é só do diretor (Gerente do evento ou Admin da agência). O resto da
-- Pré-produção continua usando as funções, a descrição e as atividades.

CREATE OR REPLACE FUNCTION event_functions_custom_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user = 'core_app' AND NOT app.can_review_sla(NEW.event_id) THEN
    IF TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'só o diretor de produção muda o nome de uma função' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' AND lower(btrim(NEW.name)) <> ALL (app.default_function_names()) THEN
      RAISE EXCEPTION 'só o diretor de produção cria funções fora da lista' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP POLICY app_delete ON event_functions;
CREATE POLICY app_delete ON event_functions FOR DELETE TO core_app
  USING (app.can_review_sla(event_id));
