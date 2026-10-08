-- Produtores e Funções (Abu, 2026-10-08): a lista de funções do evento é a
-- lista padrão da produção. Qualquer um da Pré-produção usa essas funções e
-- dá a função aos produtores; criar ou renomear uma função FORA da lista é só
-- do diretor de produção (Gerente do evento ou Admin da agência).

CREATE FUNCTION app.default_function_names() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'a&b', 'almoxarifado / inventário', 'apoio', 'arquiteto', 'atendimento', 'artístico',
    'assistente executivo', 'brindes', 'caex / credenciamento / cam', 'comunicação visual', 'criativo',
    'executivo', 'infra', 'logística', 'operação', 'runner', 'técnica', 'serviços'
  ]
$$;
REVOKE ALL ON FUNCTION app.default_function_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.default_function_names() TO core_app;

CREATE FUNCTION event_functions_custom_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user = 'core_app'
     AND lower(btrim(NEW.name)) <> ALL (app.default_function_names())
     AND NOT app.can_review_sla(NEW.event_id) THEN
    RAISE EXCEPTION 'só o diretor de produção cria funções fora da lista' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER event_functions_custom_guard
  BEFORE INSERT OR UPDATE OF name ON event_functions
  FOR EACH ROW EXECUTE FUNCTION event_functions_custom_guard();
