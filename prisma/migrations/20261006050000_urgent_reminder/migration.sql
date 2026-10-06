-- Lembrete do chamado urgente: reenviado ao encarregado da área a cada 5 minutos
-- enquanto ele não abre nem mexe no chamado (até 3 vezes).
ALTER TYPE "notification_type" ADD VALUE 'LEMBRETE';

-- O despacho procura urgentes ainda sem resposta por esta chave.
CREATE INDEX "notifications_urgent_pending" ON "notifications" ("created_at")
  WHERE "type" = 'URGENTE' AND "read_at" IS NULL;
