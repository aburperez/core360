-- 1) Quem está em campo precisa saber quem é o seu Head e o seu Gerente.
--    Operacional passa a ver, além da própria equipe, o Head da própria área e
--    os Gerentes do evento. Head passa a ver os Gerentes do evento.
--    (Contato, não dados internos de outras equipes.)
CREATE FUNCTION app.can_see_participant(
  p_event uuid, p_area uuid, p_team uuid, p_user uuid, p_role participant_role
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_user IS NOT NULL AND p_user = app.current_user_id())
      OR app.is_admin()
      OR EXISTS (
        SELECT 1 FROM app.membership(p_event) m
         WHERE m.role IN ('GERENTE', 'CLIENTE')
            OR (m.role = 'HEAD' AND (m.area_id = p_area OR p_role = 'GERENTE'))
            OR (m.role = 'OPERACIONAL' AND (
                  m.team_id = p_team
               OR p_role = 'GERENTE'
               OR (p_role = 'HEAD' AND p_area = m.area_id)))
      )
$$;
REVOKE ALL ON FUNCTION app.can_see_participant(uuid, uuid, uuid, uuid, participant_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_see_participant(uuid, uuid, uuid, uuid, participant_role) TO core_app, core_auth;

DROP POLICY app_select ON participants;
CREATE POLICY app_select ON participants FOR SELECT TO core_app
  USING (app.can_see_participant(event_id, area_id, team_id, user_id, role));

DROP FUNCTION app.can_see_participant(uuid, uuid, uuid, uuid);

-- 2) Nomes de quem abriu, concluiu ou validou uma ocorrência visível
--    (ex.: Admin, que não é participante do evento).
CREATE POLICY app_select_occurrence_actors ON users FOR SELECT TO core_app USING (
  EXISTS (
    SELECT 1 FROM occurrences o
     WHERE o.created_by = users.id OR o.concluded_by = users.id OR o.validated_by = users.id
  )
);
