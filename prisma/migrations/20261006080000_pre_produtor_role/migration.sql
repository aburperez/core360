-- Papel Pré-produtor: trabalha só na Pré-produção do evento (sem campo).
-- Fica em migration própria porque o novo valor do enum só pode ser usado
-- depois de confirmado.
ALTER TYPE participant_role ADD VALUE 'PRE_PRODUTOR';
