-- Papel Produtor executivo (hierarquia do Abu, 2026-10-20). Fica em migration
-- própria porque o novo valor do enum só pode ser usado depois de confirmado.
ALTER TYPE participant_role ADD VALUE 'PRODUTOR_EXECUTIVO';
