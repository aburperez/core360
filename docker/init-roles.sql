-- Executado uma única vez na criação do banco (dev/teste).
-- core_owner: dono das tabelas, usado só pelas migrations.
-- core_app:   usado pela aplicação; não é dono e não tem BYPASSRLS.
CREATE ROLE core_owner LOGIN PASSWORD 'core_owner_dev' CREATEDB;
CREATE ROLE core_app   LOGIN PASSWORD 'core_app_dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE core360 OWNER core_owner;
CREATE DATABASE core360_test OWNER core_owner;
\c core360
CREATE EXTENSION IF NOT EXISTS citext;
\c core360_test
CREATE EXTENSION IF NOT EXISTS citext;
