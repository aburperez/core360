-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'PRAZO';

-- CreateTable
CREATE TABLE "deadline_alerts" (
    "participant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_alerts_pkey" PRIMARY KEY ("participant_id","kind","ref_id","bucket")
);

-- CreateIndex
CREATE INDEX "deadline_alerts_event_id_idx" ON "deadline_alerts"("event_id");

-- AddForeignKey
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────────────────── Fase 7A: alertas de prazo ─────────────────────────
-- O despacho (core_worker) chama deadline_alerts(agora) a cada rodada. Cada
-- pessoa recebe no app um aviso por faixa (7 dias, 3 dias, 48 horas, véspera)
-- com os prazos dela: itens que ainda não ficaram prontos, marcos do
-- cronograma, pendências manuais e, para os Gerentes, o início do evento. Sem
-- responsável, o aviso vai para os Gerentes. Depois do fim da montagem, sai um
-- aviso com o que não foi montado e as chegadas que não aconteceram.
-- deadline_alerts guarda o que já foi avisado: nada se repete.

ALTER TABLE deadline_alerts ENABLE ROW LEVEL SECURITY;
-- Sem política: só o despacho (função abaixo, do dono) lê e grava.

CREATE FUNCTION deadline_alerts(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer := 0;
  v_m integer := 0;
BEGIN
  -- 1. Prazos com data: 7 dias, 3 dias, 48 horas e véspera.
  WITH ev AS (
    SELECT e.id, e.name, e.starts_at, e.timezone, (p_now AT TIME ZONE e.timezone)::date AS today
      FROM events e
     WHERE e.deleted_at IS NULL AND e.status NOT IN ('CONCLUIDO', 'CANCELADO')
       AND NOT app.event_closed(e.id)
  ),
  due AS (
    SELECT 'ITEM'::text AS kind, ci.id AS ref, ci.event_id, ci.name AS title, ci.needed_on AS due_on, ci.responsible_id AS resp
      FROM cost_items ci JOIN ev ON ev.id = ci.event_id
     WHERE ci.needed_on IS NOT NULL
       AND ci.status IN ('A_DEFINIR', 'EM_COTACAO', 'COTACAO_RECEBIDA', 'EM_APROVACAO', 'APROVADO', 'CONTRATADO', 'EM_PRODUCAO')
    UNION ALL
    SELECT 'MARCO', m.id, m.event_id, m.title, m.due_on, m.responsible_id
      FROM event_milestones m JOIN ev ON ev.id = m.event_id
     WHERE m.done_at IS NULL
    UNION ALL
    SELECT 'PENDENCIA', t.id, t.event_id, t.title, t.due_on, t.responsible_id
      FROM event_tasks t JOIN ev ON ev.id = t.event_id
     WHERE t.done_at IS NULL AND t.due_on IS NOT NULL
    UNION ALL
    SELECT 'INICIO', ev.id, ev.id, 'Início do evento', (ev.starts_at AT TIME ZONE ev.timezone)::date, NULL
      FROM ev
  ),
  banded AS (
    SELECT d.*,
           CASE d.due_on - ev.today WHEN 1 THEN 'vespera' WHEN 2 THEN '48h' WHEN 3 THEN '3d' ELSE '7d' END AS bucket
      FROM due d JOIN ev ON ev.id = d.event_id
     WHERE d.due_on - ev.today BETWEEN 1 AND 7
  ),
  people AS (
    SELECT p.id, p.event_id, p.role
      FROM participants p JOIN users u ON u.id = p.user_id AND u.active
     WHERE p.active AND p.deleted_at IS NULL AND p.role <> 'CLIENTE'
  ),
  target AS (
    -- O responsável (se ainda está no evento); senão, os Gerentes.
    SELECT b.kind, b.ref, b.bucket, b.event_id, pp.id AS participant_id
      FROM banded b
      JOIN people pp ON pp.event_id = b.event_id
     WHERE pp.id = b.resp
        OR (pp.role = 'GERENTE' AND NOT EXISTS (SELECT 1 FROM people r WHERE r.id = b.resp))
  ),
  fresh AS (
    INSERT INTO deadline_alerts (participant_id, kind, ref_id, bucket, event_id, sent_at)
    SELECT participant_id, kind, ref, bucket, event_id, p_now FROM target
    ON CONFLICT DO NOTHING
    RETURNING participant_id, kind, ref_id, bucket, event_id
  ),
  listed AS (
    SELECT f.participant_id, f.bucket, f.event_id, b.title, b.due_on, f.kind, f.ref_id,
           row_number() OVER (PARTITION BY f.participant_id, f.bucket ORDER BY b.due_on, b.title) AS pos,
           count(*) OVER (PARTITION BY f.participant_id, f.bucket) AS total
      FROM fresh f JOIN banded b ON b.kind = f.kind AND b.ref = f.ref_id AND b.bucket = f.bucket
  ),
  grouped AS (
    SELECT l.participant_id, l.bucket, l.event_id, max(l.total) AS total,
           string_agg(l.title || ' (' || to_char(l.due_on, 'DD/MM') || ')', ', ' ORDER BY l.pos) FILTER (WHERE l.pos <= 5) AS names,
           md5(string_agg(l.kind || l.ref_id, ',' ORDER BY l.kind, l.ref_id)) AS hash
      FROM listed l
     GROUP BY l.participant_id, l.bucket, l.event_id
  )
  INSERT INTO notifications (id, user_id, event_id, type, title, body, dedupe_key, link)
  SELECT gen_random_uuid(), p.user_id, g.event_id, 'PRAZO',
         CASE g.bucket WHEN 'vespera' THEN 'Prazo amanhã' WHEN '48h' THEN 'Prazo em 48 horas'
                       WHEN '3d' THEN 'Prazo em 3 dias' ELSE 'Prazo nos próximos 7 dias' END,
         g.names || CASE WHEN g.total > 5 THEN ' e mais ' || (g.total - 5) ELSE '' END,
         'prazo:' || g.event_id || ':' || g.bucket || ':' || g.hash,
         CASE WHEN p.role IN ('GERENTE', 'PRE_PRODUTOR') THEN '/eventos/' || g.event_id || '/pre-producao/pendencias'
              ELSE '/eventos/' || g.event_id END
    FROM grouped g
    JOIN participants p ON p.id = g.participant_id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 2. Fim da montagem (até um dia depois): o que não foi montado e as chegadas que faltaram.
  WITH ev AS (
    SELECT e.id, e.name
      FROM events e
     WHERE e.deleted_at IS NULL AND e.status NOT IN ('CONCLUIDO', 'CANCELADO') AND NOT app.event_closed(e.id)
       AND e.setup_ends_at IS NOT NULL AND p_now >= e.setup_ends_at AND p_now < e.setup_ends_at + interval '1 day'
  ),
  open_items AS (
    SELECT DISTINCT ci.id, ci.event_id, ci.name, ci.responsible_id
      FROM ev
      JOIN arrivals a ON a.event_id = ev.id
      JOIN arrival_items ai ON ai.arrival_id = a.id
      JOIN cost_items ci ON ci.id = ai.cost_item_id
     WHERE ci.status NOT IN ('MONTADO', 'CONFERIDO', 'FINALIZADO')
  ),
  missing AS (
    SELECT a.event_id, count(*) AS n FROM ev JOIN arrivals a ON a.event_id = ev.id WHERE a.status = 'AGENDADO' GROUP BY a.event_id
  ),
  per_event AS (
    SELECT ev.id AS event_id, ev.name,
           (SELECT count(*) FROM open_items o WHERE o.event_id = ev.id) AS items,
           coalesce((SELECT n FROM missing m WHERE m.event_id = ev.id), 0) AS arrivals
      FROM ev
  ),
  people AS (
    SELECT p.id, p.event_id, p.role, p.user_id
      FROM participants p JOIN users u ON u.id = p.user_id AND u.active
     WHERE p.active AND p.deleted_at IS NULL AND p.role <> 'CLIENTE'
  ),
  target AS (
    -- Os Gerentes recebem o total; cada responsável, os itens dele.
    SELECT pp.id AS participant_id, pe.event_id, pe.name, pp.user_id, true AS manager,
           pe.items, pe.arrivals, NULL::text AS names
      FROM per_event pe JOIN people pp ON pp.event_id = pe.event_id AND pp.role = 'GERENTE'
     WHERE pe.items + pe.arrivals > 0
    UNION ALL
    SELECT pp.id, o.event_id, max(pe.name), pp.user_id, false, count(*), 0,
           string_agg(o.name, ', ' ORDER BY o.name)
      FROM open_items o
      JOIN per_event pe ON pe.event_id = o.event_id
      JOIN people pp ON pp.id = o.responsible_id AND pp.role <> 'GERENTE'
     GROUP BY pp.id, o.event_id, pp.user_id
  ),
  fresh AS (
    INSERT INTO deadline_alerts (participant_id, kind, ref_id, bucket, event_id, sent_at)
    SELECT participant_id, 'MONTAGEM', event_id, 'pos', event_id, p_now FROM target
    ON CONFLICT DO NOTHING
    RETURNING participant_id
  )
  INSERT INTO notifications (id, user_id, event_id, type, title, body, dedupe_key, link)
  SELECT gen_random_uuid(), t.user_id, t.event_id, 'PRAZO', 'A montagem terminou com pendências',
         CASE
           WHEN t.manager THEN concat_ws(' e ',
             CASE WHEN t.items = 1 THEN '1 item não montado' WHEN t.items > 1 THEN t.items || ' itens não montados' END,
             CASE WHEN t.arrivals = 1 THEN '1 chegada não aconteceu' WHEN t.arrivals > 1 THEN t.arrivals || ' chegadas não aconteceram' END)
           ELSE 'Falta montar ' || t.names END,
         'montagem:' || t.event_id,
         CASE WHEN t.manager THEN '/eventos/' || t.event_id || '/pre-producao/montagem' ELSE '/eventos/' || t.event_id || '/montagem' END
    FROM target t
    JOIN fresh f ON f.participant_id = t.participant_id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_m = ROW_COUNT;

  RETURN v_n + v_m;
END $$;
REVOKE ALL ON FUNCTION deadline_alerts(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deadline_alerts(timestamptz) TO core_worker;
