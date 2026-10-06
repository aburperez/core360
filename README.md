# CORE 360 — Gestão de Campo

Aplicação de gestão operacional de eventos: cliente → evento → área → equipe →
participantes → ocorrências, com controle de acesso hierárquico e isolamento de
dados validados no backend e no banco.

A proposta aprovada (arquitetura, modelo de dados, segurança e plano do MVP)
está em [`docs/01-arquitetura-e-modelo-de-dados.md`](docs/01-arquitetura-e-modelo-de-dados.md).

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 (com Row Level Security) ·
Prisma 7 · Better Auth · Zod · Vitest. Próximas etapas: storage S3 (R2/MinIO) e telas.

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

Contas de demonstração (só dev): senha `core360-demo` para todos, por exemplo
`marina@rockfestival.dev` (Gerente), `rafael@rockfestival.dev` (Head de Infra),
`joao@rockfestival.dev` (Operacional da Elétrica; Head no Congresso),
`claudia@rockproducoes.dev` (Cliente) e `admin@core360.dev`.

## Papéis do banco

| Papel | Uso |
|---|---|
| `core_owner` | Dono das tabelas. Só migrations e seed (`DATABASE_URL`). |
| `core_app` | Usado pela aplicação (`APP_DATABASE_URL`). Não é dono, não tem `BYPASSRLS`, não apaga dados de negócio, não altera a auditoria e não toca nas sessões. Toda consulta roda com `app.user_id` definido e passa pela RLS. |
| `core_auth` | Usado só pelo login e pelos convites (`AUTH_DATABASE_URL`). Enxerga apenas tabelas de identidade. |

Em produção, crie os três papéis antes da primeira migration (veja `docker/init-roles.sql`, com senhas próprias).

## Segurança em 3 camadas

1. **Interface**: só esconde o que o usuário não usa.
2. **Backend** (`src/server/authz/policy.ts` + `src/modules/*`): monta o usuário a partir da sessão a cada requisição, valida a entrada com Zod, ignora campos controlados pelo servidor e filtra toda consulta pelo escopo. Recurso fora do escopo responde **404**.
3. **Banco** (`prisma/migrations/*_rls_access_control`): RLS em todas as tabelas de negócio. Sem `app.user_id`, nada é visível.

`tests/authz/policy-parity.test.ts` garante que as camadas 2 e 3 dão a mesma resposta para todo papel × recurso.

## API

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/auth/sign-in/email` | Login (Better Auth) |
| POST | `/api/invitations/accept` | Aceitar convite e definir senha (público) |
| GET | `/api/me` | Usuário e participações |
| GET/POST | `/api/events` | Eventos visíveis / criar (Admin) |
| GET | `/api/events/:id` | Detalhe do evento |
| GET/POST | `/api/events/:id/areas` | Áreas |
| GET | `/api/events/:id/teams` | Equipes (`?areaId=`) |
| POST | `/api/areas/:id/teams` | Criar equipe |
| GET/POST | `/api/events/:id/participants` | Montar equipe |
| PATCH | `/api/participants/:id` | Editar, mudar papel, ativar/desativar |
| POST | `/api/participants/:id/invitation` | Gerar link de convite |
| GET/POST | `/api/events/:id/occurrences` | Ocorrências (`?status=&areaId=&teamId=&mine=&open=`) |
| GET | `/api/occurrences/:id` | Detalhe com histórico |
| POST | `/api/occurrences/:id/status` | Mudar status (com `expectedVersion`) |
| POST | `/api/occurrences/:id/conclude` | CONCLUIR CHAMADO |
| POST | `/api/occurrences/:id/validate` | Validação do gestor |
| POST | `/api/occurrences/:id/assign` | Reatribuir, mudar equipe/prioridade |

## Testes

```bash
pnpm test
```

Cada execução cria um banco temporário `core360_test_<id>`, aplica as migrations,
roda os testes e apaga esse banco no final. Nenhum banco existente é alterado.

## Estrutura

```
prisma/        schema, migrations (CHECKs, triggers, auditoria, RLS), seed
src/server/    infraestrutura do backend (db, auth, authz, audit, http)
src/modules/   regras de negócio por domínio (events, areas, teams, participants, occurrences)
src/app/api/   rotas HTTP finas: autenticam, chamam o serviço, traduzem erros
tests/         db (constraints), auth, authz (paridade), security (10 cenários: serviço, RLS e HTTP)
```

## Status do MVP

- [x] Etapa 0: fundação
- [x] Etapa 1: schema, migrations e seed
- [x] Etapa 2: autenticação (login, convites, inativos, limite de tentativas)
- [x] Etapa 3: autorização (contexto de acesso e matriz de papéis)
- [x] Etapa 4: isolamento (RLS) e os 10 cenários de segurança
- [x] Etapas 5 e 6 (API): cadastros, montar equipe, ocorrências, conclusão, SLA, validação
- [ ] Etapa 7: evidências (fotos)
- [ ] Etapa 8: telas mobile-first
- [ ] Etapas 9–10: dashboard, alertas, PWA e deploy
