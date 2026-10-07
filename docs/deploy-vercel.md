# Ambiente de teste na Vercel + Neon

Este é o jeito mais curto de colocar o CORE 360 no ar para o teste de usabilidade. Precisa só de uma conta na Vercel. O banco Neon é criado de dentro da Vercel, e as fotos ficam no próprio banco.

## O que acontece em cada deploy

O build da Vercel roda `pnpm vercel-build` (veja `vercel.json`), que faz:

1. `scripts/deploy-db.ts`: cria ou atualiza os papéis `core_app`, `core_auth` e `core_worker` no banco, aplica as migrations que faltam e, se `ADMIN_EMAIL` estiver definido, cria a conta do Admin e o evento "Teste de usabilidade".
2. `next build`.

Rodar de novo não apaga nem recria nada. A senha do Admin só é usada na primeira vez; depois disso, mudar `ADMIN_PASSWORD` não troca a senha.

## Variáveis de ambiente

| Variável | Quem define | Para que serve |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | A Vercel, ao ligar o banco Neon ao projeto | Conexão do dono do banco. O app monta a dos outros papéis a partir dela (`src/server/db/urls.ts`). |
| `BETTER_AUTH_SECRET` | Você | Texto aleatório com 40 caracteres ou mais. Protege o login e gera as senhas dos papéis do banco. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Você | Conta do Admin criada no primeiro deploy. A senha precisa de pelo menos 10 caracteres. |
| `STORAGE_DRIVER` | Você: `database` | Guarda as fotos no banco. Para o piloto real, troque para `s3` com Cloudflare R2. |
| `CRON_SECRET` | Opcional | Protege `/api/cron/dispatch`, para um agendador externo chamar a cada minuto. |
| `DB_ROLES_SECRET` | Opcional | Se definido, as senhas dos papéis vêm dele e não do `BETTER_AUTH_SECRET`. |

O endereço público (links dos convites e dos avisos) vem de `VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel define sozinha a cada deploy: com um domínio próprio ligado ao projeto, ela passa a usar o domínio (o mais curto, se houver mais de um). Para fixar um endereço exato, defina `APP_URL`, por exemplo `https://www.core360prod.com.br`. O login funciona em qualquer endereço que a Vercel entrega para este projeto (o `.vercel.app` e o domínio próprio).

## Avisos sem agendador

O plano gratuito da Vercel não roda tarefas a cada minuto. Por isso, enquanto alguém está com o app aberto, a consulta do sino (a cada 30 segundos) também dispara o despacho, no máximo uma vez por minuto. Isso cobre os prazos de SLA e o novo alerta do urgente sem resposta. Para não depender de alguém com o app aberto, cadastre num agendador externo gratuito uma chamada a cada minuto para `GET /api/cron/dispatch`, com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

## Limites do ambiente de teste

- **Fotos no banco:** servem para o teste, mas ocupam o espaço do banco (o Neon gratuito tem 0,5 GB). No piloto, use R2.
- **Plano Hobby da Vercel:** é para uso não comercial. Para o piloto real, use o plano Pro.
- **WhatsApp:** fica desligado até a conta da Meta estar pronta (veja `docs/whatsapp.md`). Os avisos aparecem no sino do app.
