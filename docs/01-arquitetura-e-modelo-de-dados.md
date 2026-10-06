# CORE 360 — Gestão de Campo
## Proposta de arquitetura e modelo de dados (para aprovação)

Versão 1 · 06/10/2026 · Status: **aguardando aprovação** (nenhum código foi escrito)

---

## 0. Resumo em 10 linhas

1. **Uma única aplicação Next.js (TypeScript)**, servindo telas e API, com camada de serviços separada por módulo. Sem NestJS separado no MVP: menos peças, mesma segurança.
2. **PostgreSQL + Prisma**, com migrations versionadas.
3. **Segurança em 3 camadas**: interface (só esconde), backend (decide) e banco (**Row Level Security** do Postgres como rede de proteção). Se o backend errar um filtro, o banco ainda devolve zero linhas.
4. **Autenticação com Better Auth** (e-mail + senha, link de convite, sessões no banco e revogáveis).
5. **Um usuário pode estar em vários eventos com papéis diferentes**: o papel fica no vínculo pessoa↔evento, não no usuário.
6. **Participantes e usuários unificados**: o participante é o vínculo da pessoa com o evento; ele vira "usuário com login" quando aceita o convite.
7. **Ocorrências e tarefas na mesma tabela** (campo `tipo`), com SLA calculado no servidor e várias evidências por ocorrência desde o início.
8. **Auditoria imutável no banco** (o próprio Postgres bloqueia UPDATE/DELETE no `audit_log`).
9. **PWA mobile-first**, com IDs gerados no aparelho e API idempotente, para que o modo offline entre depois sem reescrever nada.
10. **Fotos em storage S3-compatível** (Cloudflare R2, sem custo de saída), com upload direto do celular por URL assinada.

---

## 1. Análise do briefing e do ambiente

### O que o briefing exige de verdade
- O núcleo é **hierarquia + isolamento**. Telas, dashboards e relatórios são consequência disso. Por isso a ordem será: schema → autenticação → autorização → isolamento → testes de segurança → telas.
- Há **dois pontos do briefing que se contradizem** e que eu resolvi na modelagem (detalhes na seção 4):
  - A tabela `USUARIOS` tem `evento_id`, `area_id`, `equipe_id` únicos, mas a regra 14 exige que o João seja Head no Evento A e Operacional no Evento B. **Solução:** o papel vai para o vínculo com o evento (`participants`), e `users` guarda só a identidade.
  - `PARTICIPANTES` e `USUARIOS` repetem os mesmos dados (nome, e-mail, perfil, evento, área, equipe). Duas fontes da verdade sobre "quem pode ver o quê" é exatamente o tipo de coisa que gera falha de segurança. **Solução:** uma tabela só (`participants`) define o escopo; `users` só identifica quem está logado.
- `head_id` em `areas` e `equipes`: se o escopo do Head vier de `areas.head_id` **e** do perfil do participante, os dois podem divergir. **Solução:** o escopo vem só do participante (papel HEAD + área). O "head da área" exibido na tela é derivado disso. Para equipes, mantenho um `leader_participant_id` apenas informativo (líder da equipe), sem dar permissão.
- "Tarefas" aparece como entidade mas não tem tabela própria; o campo `tarefa_processo` está dentro da ocorrência. **Solução:** uma tabela `occurrences` com `tipo = OCORRENCIA | TAREFA`. Mesmo fluxo, mesmo SLA, mesmos filtros de acesso.

### Ambiente atual
| Item | Situação |
|---|---|
| Repositório | **Nenhum** conectado ao projeto ainda. Preciso de um repo no GitHub para começar (pode ser novo e vazio). |
| Node.js | 22.22 (LTS) ✓ |
| pnpm | 10.28 ✓ |
| PostgreSQL | 16.14 disponível localmente ✓ (dev e testes) |
| Docker | 29.6 ✓ (Postgres + MinIO para desenvolvimento) |
| Python | 3.11 (não será usado no app) |

---

## 2. Arquitetura recomendada

```
 Celular / Tablet (PWA)                          Servidor
┌─────────────────────────┐        ┌───────────────────────────────────────────┐
│ Next.js (React)         │ HTTPS  │ Next.js – rotas /api e Server Actions      │
│  • telas mobile-first    │──────▶│  ① Autenticação (Better Auth, sessão)       │
│  • IndexedDB (fila       │        │  ② Contexto de acesso do usuário            │
│    offline, fase 2)      │        │  ③ Serviços por módulo + políticas (RBAC)  │
│  • câmera / upload       │        │  ④ Prisma em transação com app.user_id     │
└───────────┬─────────────┘        └──────────────┬──────────────────────────────┘
            │ upload direto (URL assinada)         │ papel "core_app" (sem BYPASSRLS)
            ▼                                       ▼
   ┌──────────────────┐                ┌────────────────────────────────┐
   │ Storage S3 (R2)  │                │ PostgreSQL                      │
   │ fotos/evidências │                │  • RLS em todas as tabelas      │
   └──────────────────┘                │  • audit_log imutável           │
                                        │  • FKs compostas (consistência) │
                                        └────────────────────────────────┘
```

### Por que um monólito Next.js e não Next.js + NestJS
- **Velocidade e manutenção**: um repositório, um deploy, um conjunto de tipos compartilhado entre tela e API.
- **Segurança não depende do framework**: toda regra fica numa camada de serviços (`src/modules/*`) que não sabe se foi chamada por uma tela ou pela API. As rotas são finas: autenticam, validam a entrada (Zod) e chamam o serviço.
- **Preparado para crescer**: se um dia for preciso um backend separado (app nativo, integrações pesadas), a pasta `src/modules` é extraída quase sem mudança, porque não depende de React.
- Tarefas assíncronas (alertas de SLA, envio de notificações) rodam como **job agendado** (cron) chamando o mesmo serviço. No MVP, um cron a cada minuto basta; fila dedicada só quando houver Telegram/WhatsApp.

### Hospedagem sugerida (baixo custo)
| Peça | Produção | Desenvolvimento |
|---|---|---|
| App | Vercel (ou VPS com Docker, se preferir custo fixo) | `pnpm dev` |
| Banco | Neon ou Supabase **apenas como Postgres gerenciado** (plano gratuito/baixo) | Postgres via Docker |
| Fotos | Cloudflare R2 | MinIO via Docker |
| E-mail de convite | Resend (gratuito até ~3 mil/mês) | log no console |

Custo inicial estimado: perto de zero até ter uso real; tudo é trocável porque usamos padrões abertos (Postgres, S3, SMTP).

---

## 3. Stack escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (strict) | Um só idioma de ponta a ponta; tipos do banco chegam até a tela. |
| Framework | Next.js (App Router) | Telas + API no mesmo projeto; ótimo suporte a PWA. |
| UI | Tailwind CSS + shadcn/ui | Componentes acessíveis, botões grandes fáceis de padronizar, sem dependência de biblioteca pesada. |
| Banco | PostgreSQL 16 | Relacional, RLS nativo, índices e constraints fortes. |
| ORM | Prisma | Migrations versionadas, tipagem; SQL puro nas migrations para RLS e triggers. |
| Validação | Zod | Mesmo schema valida formulário e API. |
| Autenticação | Better Auth | Sessão no banco (revogável), e-mail/senha, link mágico/convite, rate limit. O projeto Auth.js passou a ser mantido pela equipe do Better Auth, então é a opção com mais futuro nesse ecossistema. |
| Storage | S3-compatível (R2 / MinIO) | Barato, upload direto do celular, troca de provedor sem mudar código. |
| Offline (fase 2) | Service Worker + IndexedDB (Dexie) | Fila local de ocorrências e fotos. |
| Testes | Vitest (unitário + integração com Postgres real) e Playwright (fluxos de tela) | Os 10 cenários de segurança rodam contra o banco real, inclusive com RLS ligado. |

**O que deliberadamente NÃO vou usar no MVP:** NestJS, GraphQL, Redis, filas (BullMQ/SQS), microserviços, Supabase Auth/RLS do Supabase (misturar com Prisma gera dois modelos de segurança). Cada um entra só quando houver necessidade concreta.

---

## 4. Estrutura de pastas

```
core360/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                 # geradas + SQL manual (RLS, triggers, papéis)
│   └── seed.ts                     # cenário "Rock Festival 2027"
├── src/
│   ├── app/                        # rotas Next.js (somente UI e handlers finos)
│   │   ├── (auth)/login/
│   │   ├── (app)/dashboard/
│   │   ├── (app)/eventos/[eventId]/...
│   │   ├── (app)/ocorrencias/...
│   │   └── api/                    # REST para PWA/offline e integrações
│   ├── server/                     # infraestrutura do backend
│   │   ├── db/                     # Prisma client + "withAccess(ctx, fn)" (seta app.user_id)
│   │   ├── auth/                   # configuração Better Auth, sessão
│   │   ├── authz/                  # contexto de acesso, papéis, matriz de permissões
│   │   ├── audit/                  # gravação do audit_log
│   │   ├── storage/                # URLs assinadas S3
│   │   └── errors/                 # NotFound/Forbidden padronizados
│   ├── modules/                    # regras de negócio, uma pasta por domínio
│   │   ├── users/
│   │   ├── clients/
│   │   ├── events/
│   │   ├── areas/
│   │   ├── teams/
│   │   ├── participants/           # inclui "Montar equipe" e convites
│   │   ├── occurrences/            # inclui máquina de status, conclusão, SLA
│   │   ├── attachments/
│   │   ├── notifications/
│   │   ├── audit/                  # leitura do histórico
│   │   └── dashboard/
│   │       (cada módulo: *.service.ts, *.policy.ts, *.schemas.ts, *.repo.ts, *.test.ts)
│   ├── components/                 # UI compartilhada (botões grandes, formulários)
│   └── lib/                        # utilitários puros (datas, SLA, uuid)
├── tests/
│   ├── security/                   # os 10 cenários obrigatórios + testes de RLS
│   └── e2e/                        # Playwright
├── docker-compose.yml              # postgres + minio para dev/teste
└── .github/workflows/ci.yml        # lint, typecheck, testes a cada push
```

Regra do código: **nenhuma tela ou rota acessa o Prisma diretamente**; tudo passa por `modules/*/service`, que recebe o contexto do usuário e aplica a política.

---

## 5. Modelo de banco de dados

Convenções: chaves `uuid` (UUID v7, ordenáveis, podem ser geradas no celular para o offline), `created_at`/`updated_at` em tudo, `deleted_at` (soft delete) onde indicado, `version int` para detectar conflitos de edição. Nomes de tabela/coluna em inglês no banco; a interface fica toda em português.

### 5.1 Diagrama

```
clients 1──N events 1──N areas 1──N teams
                │            │          │
                │            └────┐     │
                N                 N     N
          participants  (user_id?, role, area_id?, team_id?)
                │ N
                │ 1
              users ──── sessions / accounts (Better Auth)

events 1──N occurrences N──1 areas / teams / participants(responsável)
occurrences 1──N attachments
occurrences 1──N occurrence_comments (fase 2)
events 1──N sla_policies
audit_log (append-only)   notifications (por usuário)
```

### 5.2 Tabelas

**users** — identidade de quem faz login
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| email | citext | **UNIQUE**, minúsculo |
| name | text | |
| is_admin | boolean | default false. Único papel global. Só um ADMIN altera. |
| active | boolean | default true. Inativo = sem login e sessões apagadas. |
| created_at, updated_at | timestamptz | |

Tabelas do Better Auth (`sessions`, `accounts`, `verifications`) ficam ao lado, ligadas a `users.id`.

**clients**
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| name | text | NOT NULL |
| document | text | opcional; UNIQUE quando preenchido |
| contact_name, email, phone | text | |
| status | enum `ACTIVE, INACTIVE` | |
| created_at, updated_at, deleted_at | timestamptz | soft delete |

**events**
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients | índice |
| name, description | text | |
| starts_at, ends_at | timestamptz | CHECK ends_at ≥ starts_at |
| venue, address | text | |
| timezone | text | default `America/Sao_Paulo` (SLA e relatórios corretos) |
| status | enum `PLANEJAMENTO, PRE_PRODUCAO, MONTAGEM, OPERACAO, DESMONTAGEM, FINALIZADO, CANCELADO` | índice |
| created_at, updated_at, deleted_at | | |

> O gerente do evento não fica em `events.gerente_id`: ele é um `participant` com papel GERENTE. Assim o evento pode ter mais de um gerente e não há duas fontes da verdade. A tela mostra "Gerente: Fulano" a partir disso.

**areas** — criadas pelo cliente/gerente, nunca fixas no código
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK → events | |
| name, description | text | **UNIQUE (event_id, lower(name))** entre não excluídas |
| status | enum `ACTIVE, INACTIVE` | |
| created_at, updated_at, deleted_at | | |
| | | UNIQUE (event_id, id) — alvo de FK composta |

**teams**
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| event_id | uuid | |
| area_id | uuid | **FK composta (event_id, area_id) → areas(event_id, id)**: impossível criar equipe numa área de outro evento |
| name, description | text | UNIQUE (area_id, lower(name)) |
| leader_participant_id | uuid FK → participants | opcional, só informativo |
| status | enum | |
| created_at, updated_at, deleted_at | | |
| | | UNIQUE (event_id, area_id, id) |

**participants** — a pessoa dentro de um evento. É aqui que mora o escopo de acesso.
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK → events | índice |
| user_id | uuid FK → users | **nullable**: preenchido quando a pessoa aceita o convite / faz login com aquele e-mail |
| name | text | |
| email | citext | **UNIQUE (event_id, email)** — uma participação por pessoa por evento |
| phone | text | |
| job_title | text | "função" (Eletricista, Montador…) |
| role | enum `GERENTE, HEAD, OPERACIONAL, CLIENTE` | |
| area_id | uuid | FK composta (event_id, area_id) → areas |
| team_id | uuid | FK composta (event_id, area_id, team_id) → teams |
| active | boolean | |
| invited_at, joined_at | timestamptz | |
| created_by | uuid FK → users | |
| created_at, updated_at, deleted_at | | |

CHECKs que o banco garante, independentemente do código:
- `role = 'HEAD'` ⇒ `area_id` obrigatório
- `role = 'OPERACIONAL'` ⇒ `area_id` e `team_id` obrigatórios
- `role IN ('GERENTE','CLIENTE')` ⇒ área/equipe opcionais (podem ser usados só para exibição)

O João do exemplo vira duas linhas: (Evento A, HEAD, Infra) e (Evento B, OPERACIONAL, Bar). Não existe papel "ADMIN" nesta tabela: o enum simplesmente não tem esse valor, então "cliente tenta criar Admin" falha até no banco.

O `cliente_id` pedido para participantes não é repetido aqui: vem de `events.client_id`. Repetir criaria a chance de um participante apontar para um cliente diferente do evento.

**occurrences** — ocorrências e tarefas
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | pode vir do celular (offline / idempotência) |
| number | int | sequencial **por evento** para falar em campo ("chamado #142"); UNIQUE (event_id, number) |
| type | enum `OCORRENCIA, TAREFA` | |
| client_id | uuid | preenchido pelo servidor a partir do evento (denormalizado para filtros e relatórios) |
| event_id, area_id, team_id | uuid | FK composta para teams (garante coerência evento/área/equipe) |
| responsible_participant_id | uuid FK → participants | deve ser do mesmo evento (FK composta) |
| title | text | |
| process | text | "tarefa/processo" |
| description | text | |
| status | enum `PENDENTE, EM_ANDAMENTO, URGENTE, BLOQUEIO, CONCLUIDO, CANCELADO` | |
| priority | enum `BAIXA, NORMAL, ALTA, CRITICA` | |
| opened_at | timestamptz | **definido pelo servidor** (ou pelo celular no offline, com limite de tolerância) |
| sla_due_at | timestamptz | calculado na abertura a partir de `sla_policies` |
| concluded_at | timestamptz | definido pelo servidor ao concluir |
| concluded_by | uuid FK → users | |
| duration_seconds | int | `concluded_at − opened_at`, calculado pelo servidor |
| sla_breached | boolean | calculado na conclusão (e por job enquanto aberta) |
| validated_by, validated_at | | "validação do gestor" |
| validation_status | enum `PENDENTE, APROVADA, REPROVADA` | reprovar reabre o chamado |
| created_by | uuid FK → users | |
| version | int | controle de conflito |
| created_at, updated_at | | sem delete: cancelar = status CANCELADO |

CHECKs: `status='CONCLUIDO'` ⇔ `concluded_at IS NOT NULL`; `concluded_at ≥ opened_at`.

> A "evidência" do briefing vira a tabela `attachments` (várias por ocorrência desde já; custa o mesmo que uma).

**attachments**
| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| occurrence_id | uuid FK | índice |
| event_id | uuid | para RLS sem join pesado |
| storage_key | text | caminho no bucket: `eventId/occurrenceId/uuid.jpg` |
| mime_type, size_bytes, width, height | | só imagens no MVP; limite de tamanho |
| sha256 | text | evita duplicar ao re-sincronizar |
| kind | enum `EVIDENCIA, CONCLUSAO` | foto do problema × foto da solução |
| uploaded_by | uuid FK → users | |
| created_at, deleted_at | | |

**sla_policies** — prazo por prioridade, configurável por evento
| event_id | priority | target_minutes | UNIQUE (event_id, priority) |
|---|---|---|---|

Padrões sugeridos ao criar evento (editáveis): Crítica 15 min, Alta 60 min, Normal 4 h, Baixa 24 h.

**audit_log** — histórico imutável
| coluna | tipo |
|---|---|
| id | bigint identity |
| occurred_at | timestamptz default now() |
| actor_user_id | uuid |
| event_id | uuid (nullable para ações globais) |
| entity | text (`occurrence`, `participant`…) |
| entity_id | uuid |
| action | enum `CREATE, UPDATE, STATUS_CHANGE, CONCLUDE, CANCEL, REASSIGN, TEAM_CHANGE, ROLE_CHANGE, VALIDATE, DEACTIVATE, LOGIN_DENIED…` |
| before, after | jsonb (só os campos alterados) |
| ip | inet |
| user_agent | text |

O papel do app só tem `INSERT` e `SELECT` nessa tabela, e um trigger rejeita `UPDATE`/`DELETE` mesmo para o dono. A gravação acontece **na mesma transação** da alteração: ou grava os dois, ou nenhum.

**notifications** — alertas internos, já pensados para outros canais
| id | user_id | event_id | type (`NOVA, URGENTE, BLOQUEIO, SLA_PROXIMO, SLA_ESTOURADO, CONCLUIDA`) | occurrence_id | title, body | read_at | created_at |
|---|---|---|---|---|---|---|---|

Fase 2: `notification_deliveries (notification_id, channel EMAIL|TELEGRAM|WHATSAPP|PUSH, status, attempts)` e `user_channels` (preferências). O módulo de alertas gera a notificação uma vez; cada canal é só um "entregador".

### 5.3 Índices principais
- `users(email)` UNIQUE
- `events(client_id)`, `events(status)`
- `areas(event_id)`, `teams(event_id, area_id)`
- `participants(user_id, event_id) WHERE active AND deleted_at IS NULL` — **é o índice mais usado**: toda checagem de acesso passa por ele
- `participants(event_id, area_id, team_id)`, `participants(event_id, email)` UNIQUE
- `occurrences(event_id, status)`, `occurrences(event_id, area_id, status)`, `occurrences(event_id, team_id, status)`, `occurrences(responsible_participant_id, status)`, `occurrences(client_id)`, `occurrences(sla_due_at) WHERE status NOT IN ('CONCLUIDO','CANCELADO')` (job de SLA)
- `attachments(occurrence_id)`, `audit_log(entity, entity_id)`, `audit_log(event_id, occurred_at)`, `notifications(user_id, read_at)`

### 5.4 Soft delete
- Com `deleted_at`: clients, events, areas, teams, participants, attachments.
- Sem delete: occurrences (cancela), audit_log (imutável), notifications (marca lida).
- Excluir área ou equipe com ocorrências abertas é bloqueado pelo serviço.

---

## 6. Estratégia de autenticação

- **Better Auth** com **e-mail + senha** e **convite por link**. Sessão guardada no banco, cookie `httpOnly`, `secure`, `sameSite=lax`. Senhas com hash forte (scrypt/argon2), nunca em texto.
- **Fluxo de entrada de quem foi cadastrado na "Montar equipe"**: ao salvar o participante com e-mail, o sistema gera um convite. A pessoa abre o link, define a senha e o `participants.user_id` é ligado ao `users.id` pelo e-mail. Além do e-mail, o link pode ser copiado e mandado por WhatsApp (mais realista em campo).
- **Login sem senha** (código de 6 dígitos por e-mail) fica pronto para ligar depois; útil para equipe temporária.
- **Usuário inativo**: `users.active=false` ou participação inativa. Na desativação o sistema **apaga as sessões** daquele usuário; e toda requisição reconfere `active` no banco (não confia em dado guardado no cookie). Cenário 9 coberto.
- **Proteções**: limite de tentativas de login por IP e por e-mail, mensagem de erro genérica ("e-mail ou senha inválidos"), sessão expira por inatividade, troca de senha derruba as outras sessões.
- O e-mail identifica o usuário, mas **a permissão nunca vem do que o navegador envia**: vem de `participants` lido no servidor a cada requisição.

---

## 7. Estratégia de autorização (RBAC + escopo)

### 7.1 Contexto de acesso
A cada requisição o servidor monta, a partir da sessão:

```ts
type AccessContext = {
  userId: string;
  isAdmin: boolean;
  // uma entrada por participação ativa
  memberships: { eventId; clientId; role: 'GERENTE'|'HEAD'|'OPERACIONAL'|'CLIENTE'; areaId?; teamId?; participantId }[];
};
```

Nada disso vem do navegador. O `eventId` que vem na URL é só um **pedido**; o servidor confere se ele está em `memberships`.

### 7.2 Escopo de leitura
| Papel | Vê no evento | Não vê |
|---|---|---|
| ADMIN | tudo, todos os clientes | — |
| GERENTE | todo o evento: áreas, equipes, participantes, ocorrências, SLA | outros eventos/clientes |
| HEAD | sua área: equipes, participantes e ocorrências da área; lista de nomes das outras áreas (só para encaminhar chamado) | conteúdo das outras áreas |
| OPERACIONAL | seu evento, sua equipe, ocorrências da equipe e as atribuídas a ele | outras equipes, mesmo da mesma área |
| CLIENTE | dados do evento, estrutura (áreas, equipes) e participantes | ocorrências, SLA e auditoria (decisão padrão; ver seção 10) |

### 7.3 Matriz de ações (o que cada um pode fazer)
| Ação | ADMIN | GERENTE | HEAD | OPERACIONAL | CLIENTE |
|---|---|---|---|---|---|
| Criar cliente / evento | ✓ | – | – | – | – |
| Criar/editar área | ✓ | ✓ evento | – | – | ✓ evento |
| Criar/editar equipe | ✓ | ✓ evento | ✓ sua área | – | ✓ evento |
| Cadastrar participante | ✓ | ✓ evento | ✓ sua área | – | ✓ evento |
| Abrir ocorrência | ✓ | ✓ | ✓ sua área | ✓ sua equipe | – |
| Mudar status / reatribuir | ✓ | ✓ | ✓ sua área | ✓ só as atribuídas a ele | – |
| Concluir chamado | ✓ | ✓ | ✓ sua área | ✓ só as atribuídas a ele | – |
| Validar (gestor) | ✓ | ✓ | ✓ sua área | – | – |
| Ver auditoria | ✓ | ✓ evento | ✓ sua área | da própria ocorrência | – |

### 7.4 Quem pode dar qual papel (anti-escalada de privilégio)
| Quem cadastra | Pode atribuir |
|---|---|
| ADMIN | GERENTE, HEAD, OPERACIONAL, CLIENTE e ADMIN (este só em `users.is_admin`) |
| GERENTE | HEAD, OPERACIONAL, CLIENTE no seu evento |
| HEAD | OPERACIONAL na sua área |
| CLIENTE | CLIENTE e OPERACIONAL no seu evento |
| Qualquer um | **nunca altera a própria participação** (papel, área, equipe, ativo) |

Mais três garantias: o enum de `participants.role` não contém ADMIN; o campo `is_admin` não é aceito por nenhuma rota exceto a de administração; e toda mudança de papel grava `ROLE_CHANGE` no `audit_log`.

### 7.5 Como fica no código
Cada módulo tem uma `policy` com funções puras e testáveis, por exemplo:

```ts
canViewOccurrence(ctx, occ)   // admin | gerente do evento | head da área | operacional da equipe/atribuído
canAssignRole(ctx, eventId, targetRole, targetAreaId)
scopeFilter(ctx, eventId)     // devolve o "where" do Prisma para listas
```

Os serviços sempre chamam a política **e** usam `scopeFilter` nas consultas. Ou seja: listar ocorrências nunca é "buscar tudo e filtrar depois"; a consulta já sai restrita.

**Recurso fora do escopo responde 404, não 403**, para não confirmar que aquele ID existe (exceção: ações sobre recurso visível mas não permitido, como Head tentando validar algo que só vê, que respondem 403).

---

## 8. Estratégia de isolamento dos dados (as 3 camadas)

### Camada 1 — Interface
Menus, botões e telas aparecem de acordo com o papel (ex.: "Concluir chamado" some quando `status = CONCLUIDO`; "Montar equipe" só para Cliente/Gerente/Admin). **É conveniência, não segurança.**

### Camada 2 — Backend (a que decide)
- Contexto de acesso montado no servidor (seção 7.1).
- Entrada validada com Zod; campos que o usuário não pode definir (`client_id`, `opened_at`, `concluded_at`, `created_by`, `duration_seconds`, `role` acima do permitido) são **ignorados ou recusados**, nunca aceitos do navegador.
- `client_id`/`event_id` de uma ocorrência são derivados da equipe escolhida, não do que vem no formulário.
- URLs de fotos são **assinadas e expiram** (ex.: 5 min), geradas só depois de checar se o usuário pode ver aquela ocorrência. O bucket é privado.

### Camada 3 — Banco (Row Level Security)
- O app conecta com um papel `core_app` que **não é dono das tabelas e não tem BYPASSRLS**. Migrations rodam com outro papel.
- Cada requisição roda numa transação que faz `SET LOCAL app.user_id = '<uuid>'`. Se ninguém setar, as políticas devolvem **zero linhas** (falha fechada).
- Funções auxiliares no banco (`SECURITY DEFINER`, `STABLE`), consultando `users` e `participants`:

```sql
app.is_admin()                       -- users.is_admin AND active
app.event_role(event_id)             -- papel do usuário naquele evento (ou NULL)
app.can_see_area(event_id, area_id)
app.can_see_team(event_id, area_id, team_id)
```

- Exemplo de política para `occurrences`:

```sql
-- a checagem fica numa função SECURITY DEFINER para não depender da RLS de participants
CREATE POLICY occ_select ON occurrences FOR SELECT
  USING (app.can_see_occurrence(event_id, area_id, team_id, responsible_participant_id));

-- corpo de app.can_see_occurrence:
SELECT app.is_admin()
  OR EXISTS (
    SELECT 1 FROM participants p
    WHERE p.user_id = app.current_user_id()
      AND p.event_id = $1
      AND p.active AND p.deleted_at IS NULL
      AND (
           p.role = 'GERENTE'
        OR (p.role = 'HEAD'        AND p.area_id = $2)
        OR (p.role = 'OPERACIONAL' AND (p.team_id = $3 OR p.id = $4))
      )
  );
```

- Políticas equivalentes de `SELECT/INSERT/UPDATE` para events, areas, teams, participants, attachments, notifications e audit_log. As regras finas de *ação* (quem pode validar, quem pode dar qual papel) ficam no backend; o banco garante o *perímetro* (ninguém lê ou grava fora do seu evento/área/equipe).
- **FKs compostas** impedem combinações impossíveis (equipe de outro evento, responsável de outro evento) mesmo se alguém montar a requisição na mão.

**Resultado:** para o Operacional da Elétrica ver um chamado da Cenografia, seriam necessárias falhas simultâneas na política do serviço, no filtro da consulta **e** na RLS do banco. Os testes verificam cada camada separadamente.

---

## 9. Plano de implementação do MVP

Cada etapa termina com testes passando e uma mensagem sua de "ok" antes da próxima grande etapa (como pediu no item 29). Antes de cada uma eu explico: o que, por quê, arquivos e como testo.

| # | Etapa | Entrega | Como é testado |
|---|---|---|---|
| 0 | **Fundação** | Repo, Next.js, TypeScript strict, lint, Docker (Postgres + MinIO), CI no GitHub | CI verde |
| 1 | **Schema + migrations** | Todas as tabelas da seção 5, enums, FKs compostas, CHECKs, índices, seed "Rock Festival 2027" | Testes de constraint (ex.: equipe em área de outro evento é recusada pelo banco) |
| 2 | **Autenticação** | Login, logout, convite, sessão, bloqueio de inativo, rate limit | Cenário 9 + login inválido |
| 3 | **Autorização (RBAC)** | `AccessContext`, policies, matriz de papéis, anti-escalada | Testes unitários da matriz; cenários 7 e 8 |
| 4 | **Isolamento (RLS)** | Papel `core_app`, `withAccess`, funções e políticas RLS, audit_log imutável | **Os 10 cenários**, rodando duas vezes: pelo serviço e direto no banco com RLS |
| 5 | **Módulos de cadastro** | Clientes, eventos, áreas, equipes, participantes, convites (API) | Integração por papel |
| 6 | **Ocorrências** | Abrir, atribuir, máquina de status, concluir (com SLA e histórico), validar, cancelar | Regras de status e SLA; cenários 1–6, 10 |
| 7 | **Evidências** | Upload por URL assinada, compressão no celular, várias fotos, visualização protegida | Foto de outra equipe não gera URL |
| 8 | **Telas mobile-first** | Login, Dashboard, Eventos, Evento, Áreas, Equipes, Participantes, Ocorrências, Nova ocorrência, Detalhe, **Montar equipe** | Playwright em viewport de celular |
| 9 | **Dashboard básico + alertas internos** | Cartões por papel, SLA médio, por área/equipe; notificações internas (nova, urgente, bloqueio, SLA) | Números conferidos com o seed |
| 10 | **Fechamento do MVP** | PWA instalável, revisão de segurança, deploy | Os 10 cenários + revisão de segurança antes do deploy |

**Depois do MVP (fase 2):** offline completo (fila de ocorrências e fotos com sincronização e tela de conflito), relatórios de SLA, Telegram/WhatsApp/e-mail/push, BI, comentários na ocorrência, modelos de evento.

### Preparação para o offline já no MVP (custa pouco agora, custa caro depois)
- IDs gerados no aparelho (UUID v7): criar a mesma ocorrência duas vezes ao re-sincronizar não duplica (operação idempotente).
- Coluna `version` em tudo que é editável: o servidor recusa edição baseada em versão antiga com **409 Conflito**, e o app mostra "este chamado mudou, veja o que mudou" em vez de sobrescrever calado.
- Regras de conflito definidas desde já: criar nunca conflita; "Concluído/Cancelado" ganha de mudança de status antiga; edições de texto pedem escolha do usuário.
- Indicador visível "sem conexão · 3 itens aguardando envio", nunca esconder o erro.

---

## 10. Usabilidade: propostas para maximizar o uso em campo

Você pediu para maximizar a usabilidade. Estas são as que eu incluiria, separadas entre MVP e depois:

**No MVP**
1. **Abrir chamado em 3 toques**: botão flutuante "+" em todas as telas → foto (câmera já aberta) → título + prioridade. Evento, área e equipe vêm **preenchidos pelo contexto** do usuário; Operacional não escolhe nada que já se sabe.
2. **Número curto do chamado** (#142) para falar no rádio/WhatsApp, em vez de ID longo.
3. **Ações grandes no detalhe**: "Assumir", "Iniciar", "Bloqueio", "Concluir" como botões de largura total; concluir pede foto da solução (opcional, configurável).
4. **Navegação inferior fixa** com 4 itens: Início, Chamados, Novo, Equipe.
5. **Montar equipe com importação**: colar uma lista do Excel/WhatsApp ou subir CSV (nome, e-mail, telefone, função, equipe) em vez de digitar um por um. É o que mais economiza tempo do cliente.
6. **Convite por link copiável** (WhatsApp), além do e-mail.
7. **Fotos comprimidas no celular** antes do envio (≈300 KB), para subir rápido em rede ruim.
8. **SLA visual**: cartão do chamado com contador e cor (verde/amarelo/vermelho).

**Depois**
9. **Duplicar estrutura de um evento anterior** (áreas, equipes, participantes): eventos recorrentes montam a equipe em segundos.
10. **QR code por equipe/local**: escanear abre "novo chamado" já na equipe/local certos.
11. Ditado por voz na descrição, modo escuro de alto contraste para operação noturna.

---

## 11. Decisões que tomei por padrão (posso mudar se preferir)

1. **Cliente não vê ocorrências** no MVP (só estrutura e participantes). Alternativa: marcar ocorrências como "visível ao cliente".
2. **Cliente pode cadastrar Cliente e Operacional**, mas Head e Gerente só Gerente/Admin atribuem. Motivo: evita que alguém crie uma segunda conta como Head para ver ocorrências.
3. **Operacional vê todas as ocorrências da sua equipe** (não só as atribuídas a ele).
4. **Head enxerga os nomes das outras áreas** (só para poder encaminhar um chamado), sem ver o conteúdo delas.
5. **Uma participação por pessoa por evento** (um papel por evento). Head de duas áreas no mesmo evento fica para depois.
6. **Eventos são criados pelo Admin**; o cliente monta a estrutura dentro deles.
7. **Prazos de SLA padrão**: Crítica 15 min, Alta 1 h, Normal 4 h, Baixa 24 h, editáveis por evento.

## 12. O que preciso de você para começar

- **Aprovação** desta proposta (ou ajustes).
- **Um repositório no GitHub** (pode ser novo e vazio, ex.: `aburperez/core360`) conectado ao projeto, para eu começar pela etapa 0.
