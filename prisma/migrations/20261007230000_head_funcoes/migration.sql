-- Head dá a função: o Head de uma área escolhe a função de cada Operacional
-- da área dele. A Pré-produção (Gerente, Pré-produtor, Admin) continua dando
-- a função a qualquer pessoa do campo. O Head não lê a ficha (documento,
-- contato de emergência): só a função, por app.function_assignments, e só
-- grava a função, por app.give_function.

-- Pode dar a função a esta pessoa?
CREATE FUNCTION app.can_give_function(p_event uuid, p_participant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_field_person(p_event, p_participant) AND (
    app.can_use_pre_production(p_event)
    OR EXISTS (
      SELECT 1
        FROM app.membership(p_event) m
        JOIN participants p ON p.id = p_participant AND p.event_id = p_event
       WHERE m.role = 'HEAD' AND p.role = 'OPERACIONAL'
         AND m.area_id IS NOT NULL AND p.area_id = m.area_id
    )
  )
$$;
REVOKE ALL ON FUNCTION app.can_give_function(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_give_function(uuid, uuid) TO core_app;

-- Pode dar função a alguém neste evento (e por isso ver a lista de funções)?
CREATE FUNCTION app.can_give_functions(p_event uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.can_use_pre_production(p_event) OR coalesce(app.event_role(p_event) = 'HEAD', false)
$$;
REVOKE ALL ON FUNCTION app.can_give_functions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_give_functions(uuid) TO core_app;

-- O Head vê o nome das funções do evento para escolher.
DROP POLICY app_select ON event_functions;
CREATE POLICY app_select ON event_functions FOR SELECT TO core_app
  USING (app.can_give_functions(event_id) OR app.is_my_function(event_id, id));

-- A função de cada pessoa a quem eu posso dar função (sem o resto da ficha).
CREATE FUNCTION app.function_assignments(p_event uuid)
RETURNS TABLE (participant_id uuid, function_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pp.participant_id, pp.function_id
    FROM participant_profiles pp
   WHERE pp.event_id = p_event
     AND pp.function_id IS NOT NULL
     AND app.can_give_function(p_event, pp.participant_id)
$$;
REVOKE ALL ON FUNCTION app.function_assignments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.function_assignments(uuid) TO core_app;

-- Dá (ou tira, com NULL) a função; devolve a função anterior.
CREATE FUNCTION app.give_function(p_event uuid, p_participant uuid, p_function uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_before uuid;
BEGIN
  IF app.current_user_id() IS NULL OR NOT app.can_give_function(p_event, p_participant) THEN
    RAISE EXCEPTION 'você não pode dar função a esta pessoa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_function IS NOT NULL AND NOT EXISTS (SELECT 1 FROM event_functions f WHERE f.id = p_function AND f.event_id = p_event) THEN
    RAISE EXCEPTION 'função de outro evento' USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT pp.function_id INTO v_before FROM participant_profiles pp WHERE pp.participant_id = p_participant AND pp.event_id = p_event;
  INSERT INTO participant_profiles (event_id, participant_id, function_id, updated_by, updated_at)
  VALUES (p_event, p_participant, p_function, app.current_user_id(), now())
  ON CONFLICT (participant_id) DO UPDATE SET function_id = EXCLUDED.function_id, updated_at = now();
  RETURN v_before;
END $$;
REVOKE ALL ON FUNCTION app.give_function(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.give_function(uuid, uuid, uuid) TO core_app;

-- A ficha: a função quem muda é quem pode dar função (não mais só a Pré-produção).
CREATE OR REPLACE FUNCTION participant_profiles_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := app.current_user_id();
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id) THEN
    RAISE EXCEPTION 'a ficha é sempre da mesma pessoa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' AND NOT app.is_field_person(NEW.event_id, NEW.participant_id) THEN
    RAISE EXCEPTION 'ficha é para alguém do campo neste evento' USING ERRCODE = 'check_violation';
  END IF;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.updated_by := v_user;
  IF NOT app.can_give_function(NEW.event_id, NEW.participant_id)
     AND NEW.function_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.function_id END) THEN
    RAISE EXCEPTION 'só a pré-produção ou o head da área escolhe a função' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
