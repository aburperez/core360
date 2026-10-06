# CORE 360 — Gestão de Campo

Aplicação de gestão operacional de eventos: cliente → evento → área → equipe →
participantes → ocorrências, com controle de acesso hierárquico e isolamento de
dados validados no backend e no banco.

A proposta aprovada (arquitetura, modelo de dados, segurança e plano do MVP)
está em [`docs/01-arquitetura-e-modelo-de-dados.md`](docs/01-arquitetura-e-modelo-de-dados.md).

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 · Prisma 7 · Zod · Vitest.
Próximas etapas: Better Auth (login), RLS do Postgres, storage S3 (R2/MinIO).

## Rodando localmente

Pré-requisitos: Node 22, pnpm 10 e Docker.

```bash
docker compose up -d          # Postgres (com papéis core_owner/core_app) + MinIO
cp .env.example .env
pnpm install
pnpm db:migrate               # aplica as migrations
pnpm db:seed                  # cenário "Rock Festival 2027"
pnpm dev
```

## Papéis do banco

| Papel | Uso |
|---|---|
| `core_owner` | Dono das tabelas. Só migrations e seed (`DATABASE_URL`). |
| `core_app` | Usado pela aplicação (`APP_DATABASE_URL`). Não é dono, não tem `BYPASSRLS`, não apaga dados de negócio e não altera a auditoria. |

Em produção, crie os dois papéis antes da primeira migration (veja `docker/init-roles.sql`, com senhas próprias).

## Testes

```bash
pnpm test
```

Cada execução cria um banco temporário `core360_test_<id>`, aplica as migrations,
roda os testes e apaga esse banco no final. Nenhum banco existente é alterado.

## Estrutura

```
prisma/        schema, migrations (SQL com CHECKs, triggers, auditoria), seed
src/server/    infraestrutura do backend (db, auth, authz, audit, storage)
src/modules/   regras de negócio por domínio (a partir da etapa 3)
src/app/       telas e rotas Next.js (a partir da etapa 8)
tests/         testes de banco, segurança e e2e
```

## Status do MVP

- [x] Etapa 0: fundação
- [x] Etapa 1: schema, migrations e seed
- [ ] Etapa 2: autenticação
- [ ] Etapa 3: autorização (RBAC)
- [ ] Etapa 4: isolamento (RLS) e os 10 cenários de segurança
- [ ] Etapas 5–10: módulos, ocorrências, evidências, telas, dashboard, deploy
