-- Executado uma única vez na criação do banco (dev/teste).
-- core_owner: dono das tabelas, usado só pelas migrations.
-- core_app:   usado pela aplicação; não é dono e não tem BYPASSRLS.
-- core_auth:  usado só pelo login/convites; enxerga apenas tabelas de identidade.
-- core_worker: despacha avisos (app e WhatsApp); lê chamados, grava avisos. Sem sessões nem fotos.
CREATE ROLE core_owner LOGIN PASSWORD 'core_owner_dev' CREATEDB;
CREATE ROLE core_app   LOGIN PASSWORD 'core_app_dev' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE core_auth  LOGIN PASSWORD 'core_auth_dev' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE core_worker LOGIN PASSWORD 'core_worker_dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE core360 OWNER core_owner;
CREATE DATABASE core360_test OWNER core_owner;
\c core360
CREATE EXTENSION IF NOT EXISTS citext;
\c core360_test
CREATE EXTENSION IF NOT EXISTS citext;
