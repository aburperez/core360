# Avisos no WhatsApp

O CORE 360 manda os avisos importantes para o WhatsApp de quem aceitou recebê-los. A mensagem tem o botão "Abrir no app". Quando a pessoa é Operacional da equipe e o chamado ainda está sem responsável, a mensagem também tem o botão "Assumir".

O envio usa a **API oficial do WhatsApp Business (Cloud API, da Meta)**. Não use soluções que conectam um WhatsApp comum, porque o número pode ser banido no meio do evento.

## O que vai para o WhatsApp

| Aviso | Quem recebe |
|---|---|
| Chamado urgente (status Urgente ou prioridade Crítica) | Gerente, Head da área e o responsável. Se o chamado não tiver responsável, a equipe toda recebe. |
| Chamado atribuído a você | O novo responsável |
| Chamado bloqueado | Gerente, Head da área e o responsável |
| SLA perto de estourar (faltando 20% do prazo ou 5 min) | O responsável (ou a equipe, se não houver responsável) e o Head da área |
| SLA estourado | O responsável (ou a equipe), o Head e o Gerente |
| Chamado reprovado na validação | O responsável |

Alguns avisos ficam só no app: "novo chamado na equipe" e "concluído, falta validar".

Ninguém recebe aviso de um chamado que não poderia abrir. A regra de quem pode ver é a mesma do resto do sistema. Quem fez a mudança também não recebe o aviso dela.

## Como a pessoa liga os avisos

- **No convite:** ao criar o acesso, a pessoa marca "Receber avisos no WhatsApp" e confirma o número.
- **Depois, na tela Avisos** (o sino no topo): a pessoa liga, desliga ou troca o número.

## Configuração na Meta

Isso é feito uma vez, por quem administra a conta.

1. Crie ou use uma conta **Meta Business** verificada e um app em developers.facebook.com com o produto WhatsApp.
2. Cadastre um **número exclusivo** para o CORE 360. Ele não pode estar em uso em outro WhatsApp.
3. Crie os dois **modelos de mensagem** abaixo, na categoria **Utilidade** e no idioma **Português (BR)**, e aguarde a aprovação da Meta.
4. Em Webhooks, cadastre a URL `https://SEU-DOMINIO/api/whatsapp/webhook`, informe o mesmo `WHATSAPP_VERIFY_TOKEN` e assine o campo `messages`.
5. Preencha as variáveis de ambiente e troque `WHATSAPP_DRIVER` para `cloud`.

### Modelo `core360_alerta`

Corpo:

```
*{{1}}*
Chamado #{{2}}: {{3}}
{{4}}
```

Botão: **Visitar site**, com o texto "Abrir no app" e a URL dinâmica `https://SEU-DOMINIO/c/{{1}}`.

Exemplo dos parâmetros: `Chamado urgente`, `142`, `Quadro elétrico do palco 2 desarmando`, `Elétrica · Infraestrutura`.

### Modelo `core360_alerta_assumir`

O corpo é o mesmo do modelo anterior. Os botões, nesta ordem:

1. **Resposta rápida**: "Assumir"
2. **Visitar site**: "Abrir no app", com a URL `https://SEU-DOMINIO/c/{{1}}`

## Variáveis de ambiente

| Variável | Para que serve |
|---|---|
| `WHATSAPP_DRIVER` | `off` não envia, `log` só mostra no terminal (desenvolvimento) e `cloud` envia de verdade. |
| `WHATSAPP_TOKEN` | Token de acesso permanente (usuário do sistema da Meta) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número no painel do WhatsApp |
| `WHATSAPP_APP_SECRET` | Chave secreta do app. É usada para conferir que o webhook veio mesmo da Meta. |
| `WHATSAPP_VERIFY_TOKEN` | Texto que você escolhe e repete no cadastro do webhook |
| `WHATSAPP_API_VERSION` | Versão da API da Meta (padrão `v21.0`) |
| `WHATSAPP_ACTION_SECRET` | Assina o botão "Assumir". Se ficar vazia, usa `BETTER_AUTH_SECRET`. |
| `APP_URL` | Endereço público do app, usado nos links |
| `CRON_SECRET` | Protege a rota `/api/cron/dispatch` |
| `WORKER_DATABASE_URL` | Conexão com o papel `core_worker` do banco |

## Despacho e agendamento

Toda mudança num chamado entra numa fila, gravada pelo próprio banco na mesma transação. Depois de cada alteração feita pelo app, o despacho roda logo após a resposta. Para conferir os prazos de SLA e reenviar o que falhou, um agendador precisa chamar a rota abaixo **a cada minuto**:

```
GET /api/cron/dispatch
Authorization: Bearer <CRON_SECRET>
```

Se a API da Meta falhar, o envio é tentado de novo depois de 1, 5 e 15 minutos. Na quarta falha, o envio é marcado como falho. Aviso com mais de 30 minutos ou já lido no app não é mais mandado para o WhatsApp.

## Segurança do botão "Assumir"

Para assumir um chamado pelo WhatsApp, todas as condições abaixo precisam ser verdadeiras:

1. O webhook tem a assinatura da Meta (`X-Hub-Signature-256`).
2. O botão traz uma assinatura que só o servidor gera, ligada àquela mensagem.
3. A resposta vem do mesmo número que recebeu a mensagem.
4. O botão ainda não foi usado, e a mensagem tem menos de 24 horas.
5. A pessoa continua ativa e pode assumir o chamado. Essa é a mesma regra do app: Operacional da equipe, chamado sem responsável e ainda aberto.

A ação fica no histórico do chamado com a origem "WhatsApp".
