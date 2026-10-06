# CORE 360 — Gestão de Campo

Aplicação de gestão operacional de eventos: cliente → evento → área → equipe →
participantes → ocorrências, com controle de acesso hierárquico e isolamento de
dados validados no backend e no banco.

A proposta aprovada (arquitetura, modelo de dados, segurança e plano do MVP)
está em [`docs/01-arquitetura-e-modelo-de-dados.md`](docs/01-arquitetura-e-modelo-de-dados.md).

## Stack

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 (com Row Level Security) ·
Prisma 7 · Better Auth · Zod · Vitest · Tailwind 4. Fotos em storage S3 (Cloudflare R2 em produção,
MinIO no desenvolvimento, `STORAGE_DRIVER=memory` nos testes).

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
| `core_worker` | Despacho de avisos (`WORKER_DATABASE_URL`). Lê chamados e pessoas, grava avisos e envios. Não lê senhas, sessões nem fotos, e não apaga nada. |

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
| POST | `/api/occurrences/:id/claim` | Operacional assume chamado sem responsável da própria equipe |
| POST | `/api/occurrences/:id/attachments` | Enviar foto (multipart, campo `file`, até 10 MB; o servidor confere se é imagem de verdade) |
| GET | `/api/attachments/:id` | Ver foto (redireciona para link assinado de curta duração) |
| GET | `/api/notifications` | Meus avisos e quantos não li (`/unread` só a contagem) |
| POST | `/api/notifications/read` | Marcar avisos como lidos (`{ ids }` ou todos) |
| GET/PUT | `/api/me/whatsapp` | Ligar ou desligar avisos no WhatsApp |
| GET/POST | `/api/whatsapp/webhook` | Webhook da Meta (assinado): botão "Assumir" e status de entrega |
| GET | `/api/cron/dispatch` | Despacho de avisos e SLA, a cada minuto (`Authorization: Bearer CRON_SECRET`) |

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
src/modules/   regras de negócio por domínio (events, areas, teams, participants, occurrences, attachments, dashboard)
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
- [x] Etapa 7: evidências (fotos com compressão no celular, verificação no servidor, links assinados)
- [x] Etapa 8: telas mobile-first (login, convite, painel por papel, chamados, novo chamado, detalhe, Montar equipe)
- [x] Dashboard por papel
- [x] Etapa 9: avisos no app (sino) e no WhatsApp, alertas de SLA, botão "Assumir" pelo WhatsApp ([docs/whatsapp.md](docs/whatsapp.md))
- [ ] Etapa 10: PWA instalável, revisão de segurança e deploy
