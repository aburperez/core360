/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandWordmark } from "./brand";
import { cx } from "./ui";

/**
 * Página pública (quem abre o domínio sem estar logado): explica o app
 * ferramenta por ferramenta. Só texto e imagens estáticas de /public/site.
 */

type Tool = {
  id: string;
  part: "campo" | "pre";
  title: string;
  serve: string;
  quem: string;
  passos: string[];
  img: string;
  alt: string;
  phone?: boolean;
};

export const TOOLS: Tool[] = [
  {
    id: "chamados", part: "campo", title: "Chamados",
    serve: "Registrar qualquer pedido do campo com foto, prioridade e prazo, em vez de pedir no rádio ou no grupo.",
    quem: "Todos que estão no campo",
    passos: [
      "Toque em + e escolha a equipe e o tipo de atendimento.",
      "Tire a foto e escreva em uma linha o que aconteceu.",
      "O prazo começa a contar e a equipe responsável recebe o aviso.",
    ],
    img: "/site/chamado.webp", alt: "Tela de novo chamado no celular", phone: true,
  },
  {
    id: "urgente", part: "campo", title: "Urgente e avisos",
    serve: "Garantir que o que é urgente chegue a quem pode resolver, mesmo com o celular no bolso.",
    quem: "Head de área e Gerente",
    passos: [
      "Marque o chamado como Urgente.",
      "O Head da área recebe o aviso no WhatsApp e no app.",
      "Se ninguém assumir, o aviso se repete a cada 5 minutos.",
    ],
    img: "/site/urgente.webp", alt: "Chamado urgente aberto no celular do Head", phone: true,
  },
  {
    id: "painel", part: "campo", title: "Painel do campo",
    serve: "Ver o evento inteiro de uma vez: o que está atrasado, quem está com o quê e o progresso de cada equipe.",
    quem: "Gerente e Diretor (o Head vê a sua área)",
    passos: [
      "Abra o evento: o painel é a primeira tela.",
      "Veja o quadro de chamados por situação e toque para abrir.",
      "Acompanhe os prazos cumpridos e o progresso de cada equipe.",
    ],
    img: "/site/painel.webp", alt: "Painel do campo no computador",
  },
  {
    id: "chegada", part: "campo", title: "Chegada, montagem e conferido",
    serve: "Acompanhar cada fornecedor do portão até o item pronto, sem ligação e sem papel.",
    quem: "Equipe do campo marca a chegada; o Head da área confirma",
    passos: [
      "Quando o fornecedor chega, toque em Chegou no celular.",
      "O Head da área marca Montado e depois Conferido, com uma foto.",
      "O status do item muda sozinho. Montagem atrasada fica vermelha no cronograma e nas pendências.",
    ],
    img: "/site/montagem-celular.webp", alt: "Itens para montar no celular do Head, com o botão Montado", phone: true,
  },
  {
    id: "planta", part: "campo", title: "Planta do evento",
    serve: "Ver no mapa do evento onde fica cada ponto de montagem e de finalização, e como está cada um.",
    quem: "Todos no campo veem; o Gerente envia a planta e o Head marca os pontos da área",
    passos: [
      "O Gerente envia a planta do evento.",
      "Os pontos de montagem e de finalização são marcados no lugar onde acontecem, por área.",
      "A cor mostra a situação de cada ponto: não iniciada, em andamento, concluída ou atrasada.",
    ],
    img: "/site/planta.webp", alt: "Etapas da planta do evento no celular, cada uma com a sua cor", phone: true,
  },
  {
    id: "equipe", part: "campo", title: "Equipe e convites",
    serve: "Montar quem trabalha no evento e definir o que cada pessoa pode ver.",
    quem: "Gerente",
    passos: [
      "Em Equipe, adicione a pessoa e escolha o papel dela.",
      "Ela recebe o convite com um link e entra pelo celular.",
      "Desativou a pessoa, o acesso sai na hora.",
    ],
    img: "/site/equipe.webp", alt: "Tela de equipe do evento no celular", phone: true,
  },
  {
    id: "ficha", part: "pre", title: "Ficha, briefing e visita técnica",
    serve: "Juntar num lugar só tudo o que se sabe do evento antes de começar a contratar.",
    quem: "Diretor e Pré-produtor",
    passos: [
      "Preencha a ficha do evento e acompanhe as 11 etapas.",
      "Responda o briefing do evento num formulário e registre a visita técnica com fotos (no mínimo 10) e relatório.",
      "Guarde os documentos do evento no mesmo lugar, para todos acharem.",
    ],
    img: "/site/briefing-evento.webp", alt: "Briefing do evento no computador",
  },
  {
    id: "itens", part: "pre", title: "Mapa de itens e orçamento",
    serve: "Saber o que o evento precisa, quem cuida de cada item e quanto ele custa de verdade.",
    quem: "Diretor e Pré-produtor (o campo nunca vê valores)",
    passos: [
      "Cada item tem código, área, categoria, responsável, prazo e status, de A definir até Finalizado.",
      "O orçamento mostra 4 valores (estimado, cotado, contratado e realizado) e aponta a economia ou o estouro.",
      "Só o Diretor vê o contratado e o realizado. O campo nunca vê valores.",
    ],
    img: "/site/orcamento.webp", alt: "Orçamento com os 4 valores no computador",
  },
  {
    id: "fornecedores", part: "pre", title: "Fornecedores, cotações e contratos",
    serve: "Cotar, escolher e contratar fornecedores com tudo registrado, do primeiro orçamento à avaliação final.",
    quem: "Pré-produtor cota; o Diretor negocia, escolhe e avalia com o Head da área",
    passos: [
      "Use o cadastro de fornecedores da agência e peça 3 orçamentos. O app lê o arquivo do orçamento (PDF ou foto) e preenche os valores para você conferir.",
      "O Diretor negocia e escolhe. O contrato é gerado e assinado no app.",
      "Depois do evento, o Diretor e o Head da área avaliam cada fornecedor.",
    ],
    img: "/site/cotacoes.webp", alt: "Cotação com 3 orçamentos no computador",
  },
  {
    id: "cronograma", part: "pre", title: "Cronograma e pendências",
    serve: "Ver o que precisa ficar pronto até o dia do evento e o que está atrasado, por área e por pessoa.",
    quem: "Diretor e Pré-produtor",
    passos: [
      "Siga os marcos de T-30 até T0, cada um com um responsável.",
      "Cada item tem prazo e pode depender de outro.",
      "Na central de pendências, veja o que está atrasado, vence hoje ou vence nos próximos 7 dias.",
    ],
    img: "/site/pendencias.webp", alt: "Central de pendências no computador",
  },
  {
    id: "mapa-montagem", part: "pre", title: "Mapa de montagem",
    serve: "Combinar a chegada de cada fornecedor na montagem, para não ter fila no portão nem caminhão perdido.",
    quem: "Diretor e Pré-produtor (o campo vê no celular)",
    passos: [
      "As chegadas nascem dos contratos assinados.",
      "Cada linha tem horário, fornecedor, itens, veículo e placa, motorista, doca, área, responsável e status.",
      "Chegada atrasada aparece em vermelho.",
    ],
    img: "/site/mapa-montagem.webp", alt: "Mapa de montagem no computador",
  },
  {
    id: "tipos", part: "pre", title: "Tipos de atendimento e SLA",
    serve: "Combinar antes do evento o prazo de cada tipo de atendimento, para o campo já começar com as regras certas.",
    quem: "Pré-produtor propõe, Gerente aprova",
    passos: [
      "Cadastre os tipos de cada equipe (ex.: elétrica, limpeza).",
      "O Pré-produtor propõe o prazo de cada tipo.",
      "O Gerente aprova, ajusta ou recusa. No campo, o chamado já nasce com esse prazo.",
    ],
    img: "/site/tipos.webp", alt: "Lista de tipos de atendimento com SLA no computador",
  },
  {
    id: "produtores", part: "pre", title: "Produtores e Funções",
    serve: "Montar numa página só quem faz o quê em cada equipe do evento.",
    quem: "Diretor monta; o Pré-produtor ajuda",
    passos: [
      "Abra Produtores e Funções.",
      "Monte por planilha ou clicando: escolha as pessoas e as funções de cada uma.",
      "Pronto: todos consultam quem faz o quê.",
    ],
    img: "/site/produtores.webp", alt: "Página Produtores e Funções no computador",
  },
  {
    id: "funcoes", part: "pre", title: "Funções e briefing",
    serve: "Dar a cada pessoa a sua função, a sua agenda e um briefing claro do que fazer.",
    quem: "Gerente e Pré-produtor escrevem; cada pessoa lê o seu",
    passos: [
      "Abra a pessoa e veja a função, a agenda e a ficha dela.",
      "Escreva o briefing: posto, horários e o que a pessoa faz.",
      "Ela lê no celular, em Meu briefing, e confirma Li e entendi.",
    ],
    img: "/site/funcoes.webp", alt: "Função, agenda e ficha de uma pessoa no computador",
  },
  {
    id: "custos", part: "pre", title: "Planilha Padrão CORE 360",
    serve: "Trazer a planilha de custos do Excel para o app e levar de volta, no modelo Padrão CORE 360.",
    quem: "Diretor e Pré-produtor (os valores só aparecem aqui)",
    passos: [
      "Importe a planilha Padrão CORE 360 em Excel. Você vê a prévia antes de confirmar.",
      "O app soma fornecedores, honorários e impostos.",
      "Baixe em Excel quando quiser. O campo recebe a lista de itens, sem os valores.",
    ],
    img: "/site/custos.webp", alt: "Planilha Padrão CORE 360 no computador",
  },
  {
    id: "relatorio", part: "pre", title: "Relatório diário",
    serve: "Fechar o dia com números claros para o cliente, sem ninguém montar planilha.",
    quem: "Gerente (o Pré-produtor também vê)",
    passos: [
      "Escolha o dia.",
      "Veja chamados abertos, concluídos, atrasados e os prazos por equipe.",
      "Escreva as observações do dia e baixe em Excel.",
    ],
    img: "/site/relatorio.webp", alt: "Relatório diário no computador",
  },
];

const PARTS = {
  campo: { label: "Gestão de campo", where: "No celular" },
  pre: { label: "Pré-produção", where: "No computador" },
} as const;

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-cyan">{children}</p>;
}

function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx("scroll-mt-20 px-4 py-16 sm:py-20 lg:px-8", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Shot({ tool }: { tool: Tool }) {
  return tool.phone ? (
    <img
      src={tool.img} alt={tool.alt} width={540} height={1099} loading="lazy"
      className="mx-auto h-[520px] w-auto rounded-[2rem] border-2 border-border object-cover object-top shadow-2xl shadow-black/40 sm:h-[600px]"
    />
  ) : (
    <img
      src={tool.img} alt={tool.alt} width={1440} height={900} loading="lazy"
      className="w-full rounded-2xl border-2 border-border shadow-2xl shadow-black/40"
    />
  );
}

function ToolBlock({ tool, n }: { tool: Tool; n: number }) {
  const part = PARTS[tool.part];
  const flip = n % 2 === 1;
  return (
    <article id={tool.id} className="scroll-mt-24 border-t border-border py-14 first:border-t-0 sm:py-16">
      <div className={cx("grid items-center gap-10 lg:gap-14", tool.phone ? "lg:grid-cols-[1fr_auto]" : "lg:grid-cols-[2fr_3fr]")}>
        <div className={cx("min-w-0", flip && !tool.phone && "lg:order-2")}>
          <Eyebrow>{part.label} · {part.where}</Eyebrow>
          <h3 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{tool.title}</h3>
          <dl className="mt-6 space-y-4">
            <div>
              <dt className="text-sm font-semibold text-brand-cyan">Para que serve</dt>
              <dd className="mt-1 text-lg leading-relaxed">{tool.serve}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-brand-cyan">Quem usa</dt>
              <dd className="mt-1 text-muted">{tool.quem}</dd>
            </div>
          </dl>
          <p className="mt-6 text-sm font-semibold text-brand-cyan">Como usar</p>
          <ol className="mt-3 space-y-3">
            {tool.passos.map((p, i) => (
              <li key={p} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-cyan text-sm font-bold text-brand-navy">{i + 1}</span>
                <span className="pt-1 leading-relaxed">{p}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className={cx("min-w-0", flip && !tool.phone && "lg:order-1")}>
          <Shot tool={tool} />
        </div>
      </div>
    </article>
  );
}

const ROLES = [
  { title: "Diretor de produção", text: "Vê todos os eventos da agência, escolhe os fornecedores e acompanha a preparação, os prazos e os custos." },
  { title: "Gerente do evento", text: "Coordena áreas, equipes e chamados e fecha o relatório do dia." },
  { title: "Head de área", text: "Recebe os urgentes da área, confirma a montagem, valida a entrega e avalia os fornecedores." },
  { title: "Produtor operacional", text: "Lê o briefing e abre e resolve chamados com foto, pelo celular." },
];

const SECURITY = [
  { title: "Dados separados", text: "Uma agência nunca vê eventos, pessoas ou custos de outra. A regra está no banco de dados, não só na tela." },
  { title: "Acesso por evento", text: "Cada pessoa entra por convite e vê só a sua parte. Saiu do evento, o acesso sai na hora." },
  { title: "Tudo registrado", text: "Quem abriu, mudou ou concluiu cada coisa fica no histórico, com data e hora." },
  { title: "Suporte com permissão", text: "A equipe CORE 360 só entra numa agência se o diretor de produção autorizar." },
];

export function Landing({ contactUrl }: { contactUrl?: string | null }) {
  const enter = "rounded-full bg-brand-cyan px-5 py-2 text-sm font-bold text-brand-navy transition hover:brightness-110";
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 lg:px-8">
          <Link href="/" aria-label="CORE 360, início"><BrandWordmark className="h-5 w-auto" /></Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Seções">
            <a href="#como-funciona" className="hover:text-foreground">Como funciona</a>
            <a href="#ferramentas" className="hover:text-foreground">Ferramentas</a>
            <a href="#seguranca" className="hover:text-foreground">Segurança</a>
            <a href="#contratar" className="hover:text-foreground">Como contratar</a>
          </nav>
          <Link href="/login" className={enter}>Entrar</Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:pt-20 lg:px-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,#0a4a63_0%,transparent_55%)]" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[5fr_6fr]">
            <div>
              <img src="/brand/core360-logo.png" alt="" width={240} height={161} className="hidden h-auto w-40 sm:block" />
              <h1 className="sm:mt-8 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                A operação do seu evento, <span className="text-brand-cyan">num só lugar</span>
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted">
                Pré-produção no computador. Gestão de campo no celular. Feito para agências de eventos.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#ferramentas" className="rounded-full bg-brand-cyan px-6 py-3 font-bold text-brand-navy transition hover:brightness-110">Conhecer as ferramentas</a>
                <Link href="/login" className="rounded-full border border-border px-6 py-3 font-semibold transition hover:border-brand-cyan">Entrar</Link>
              </div>
            </div>
            <div className="relative">
              <img src="/site/painel.webp" alt="Painel do campo no computador" width={1440} height={900} className="hidden w-full rounded-2xl border-2 border-border shadow-2xl shadow-black/50 sm:block" />
              <img src="/site/painel-celular.webp" alt="Painel do campo no celular" width={540} height={1099} className="mx-auto h-[480px] w-auto rounded-[2rem] border-2 border-border object-cover object-top shadow-2xl shadow-black/60 sm:absolute sm:-bottom-8 sm:-left-4 sm:mx-0 sm:h-72 sm:rounded-3xl lg:-left-10" />
            </div>
          </div>
        </section>

        <Section id="como-funciona" className="bg-surface/40">
          <Eyebrow>Como funciona</Eyebrow>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Duas partes que conversam</h2>
          <p className="mt-3 max-w-3xl text-lg text-muted">
            O que se combina na pré-produção vira regra no campo. O prazo aprovado para um tipo de atendimento, por exemplo, vira o prazo de cada chamado daquele tipo.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {(["pre", "campo"] as const).map((k) => (
              <div key={k} className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
                <Eyebrow>{PARTS[k].where}</Eyebrow>
                <h3 className="mt-2 text-2xl font-bold">{PARTS[k].label}</h3>
                <ul className="mt-5 space-y-2">
                  {TOOLS.filter((t) => t.part === k).map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition hover:bg-white/5">
                        <span className="font-medium">{t.title}</span>
                        <span className="text-brand-cyan" aria-hidden>→</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section id="quem-usa">
          <Eyebrow>Quem usa</Eyebrow>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Cada pessoa vê só o que precisa</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r.title} className="rounded-2xl border border-border bg-surface p-6">
                <h3 className="text-xl font-bold">{r.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{r.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-muted">E o cliente do evento pode acompanhar em modo leitura, se a agência quiser.</p>
        </Section>

        <Section id="ferramentas" className="bg-surface/40">
          <Eyebrow>Ferramentas</Eyebrow>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Cada ferramenta, passo a passo</h2>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Ferramentas">
            {TOOLS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="rounded-full border border-border px-4 py-1.5 text-sm transition hover:border-brand-cyan hover:text-brand-cyan">{t.title}</a>
            ))}
          </nav>
          <div className="mt-6">
            {TOOLS.map((t, i) => <ToolBlock key={t.id} tool={t} n={i} />)}
          </div>
        </Section>

        <Section id="seguranca">
          <Eyebrow>Segurança</Eyebrow>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Cada agência num espaço fechado</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map((s) => (
              <div key={s.title} className="rounded-2xl border border-border bg-surface p-6">
                <h3 className="text-xl font-bold text-brand-cyan">{s.title}</h3>
                <p className="mt-2 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="contratar" className="bg-surface/40">
          <div className="grid items-center gap-10 lg:grid-cols-[3fr_2fr]">
            <div>
              <Eyebrow>Como contratar</Eyebrow>
              <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Aluguel mensal por agência</h2>
              <p className="mt-3 text-lg text-muted">Sem instalar nada: funciona no navegador do computador e do celular.</p>
              <ol className="mt-8 space-y-4">
                {[
                  "Criamos o espaço da agência e convidamos o diretor de produção.",
                  "O diretor cadastra os clientes, os eventos e os outros diretores.",
                  "Montamos juntos a pré-produção do primeiro evento.",
                  "A equipe recebe o convite e usa no celular no dia.",
                ].map((p, i) => (
                  <li key={p} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-cyan text-sm font-bold text-brand-navy">{i + 1}</span>
                    <span className="pt-1 leading-relaxed">{p}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-3xl bg-brand-navy p-8 text-center">
              <img src="/brand/core360-logo.png" alt="" width={240} height={161} className="mx-auto h-auto w-36" />
              <p className="mt-6 text-2xl font-bold">Vamos fazer o seu próximo evento juntos?</p>
              <div className="mt-6 flex flex-col gap-3">
                {contactUrl && (
                  <a href={contactUrl} className="rounded-full bg-brand-cyan px-6 py-3 font-bold text-brand-navy transition hover:brightness-110">Pedir uma demonstração</a>
                )}
                <Link href="/login" className={cx("rounded-full px-6 py-3 font-semibold transition", contactUrl ? "border border-border hover:border-brand-cyan" : "bg-brand-cyan font-bold text-brand-navy hover:brightness-110")}>
                  Já tenho convite: entrar
                </Link>
              </div>
            </div>
          </div>
        </Section>
      </main>

      <footer className="border-t border-border px-4 py-8 text-sm text-muted lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <BrandWordmark className="h-4 w-auto" />
          <p>Gestão de eventos: pré-produção e campo.</p>
        </div>
      </footer>
    </div>
  );
}
