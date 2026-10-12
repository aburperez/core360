-- "Esqueci minha senha": a troca de senha pelo link do e-mail fica na auditoria.
ALTER TYPE "audit_action" ADD VALUE 'PASSWORD_RESET';
