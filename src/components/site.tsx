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
    id: "quem-faz", part: "pre", title: "Quem faz o quê",
    serve: "Deixar claro quem atende cada tipo de chamado em cada equipe.",
    quem: "Gerente e Pré-produtor",
    passos: [
      "Escolha a equipe.",
      "Marque as pessoas em cada tipo de atendimento.",
      "A matriz fica pronta para todos consultarem.",
    ],
    img: "/site/quemfaz.webp", alt: "Matriz quem faz o quê no computador",
  },
  {
    id: "custos", part: "pre", title: "Custos",
    serve: "Montar o orçamento do evento no modelo de matriz que a agência já usa, com honorários e impostos.",
    quem: "Gerente e Pré-produtor (os valores só aparecem aqui)",
    passos: [
      "Importe a sua planilha em Excel ou crie as seções e os itens.",
      "O sistema soma fornecedores, honorários e impostos.",
      "Envie a lista de itens ao campo, sem os valores, para quem vai receber conferir.",
    ],
    img: "/site/custos.webp", alt: "Planilha de custos no computador",
  },
  {
    id: "funcoes", part: "pre", title: "Funções e briefing",
    serve: "Dar a cada pessoa a sua função, a sua agenda e um briefing claro do que fazer.",
    quem: "Gerente e Pré-produtor escrevem; cada pessoa lê o seu",
    passos: [
      "Escolha as funções do evento e coloque as pessoas.",
      "Preencha posto, horários e o que a pessoa faz.",
      "Ela lê no celular, em Meu briefing, e confirma Li e entendi.",
    ],
    img: "/site/funcoes.webp", alt: "Painel de funções e briefing no computador",
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
  { title: "Diretor de produção", text: "Vê todos os eventos da agência e acompanha a preparação, os prazos e os custos." },
  { title: "Gerente do evento", text: "Coordena áreas, equipes e chamados e fecha o relatório do dia." },
  { title: "Head de área", text: "Recebe os urgentes da área, distribui para a equipe e valida a entrega." },
  { title: "Produtor operacional", text: "Lê o briefing e abre e resolve chamados com foto, pelo celular." },
];

const SECURITY = [
  { title: "Dados separados", text: "Uma agência nunca vê eventos, pessoas ou custos de outra. A regra está no banco de dados, não só na tela." },
  { title: "Acesso por evento", text: "Cada pessoa entra por convite e vê só a sua parte. Saiu do evento, o acesso sai na hora." },
  { title: "Tudo registrado", text: "Quem abriu, mudou ou concluiu cada coisa fica no histórico, com data e hora." },
  { title: "Suporte com permissão", text: "A equipe CORE 360 só entra numa agência se o Admin da agência autorizar." },
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
                  "Criamos o espaço da agência e convidamos o Admin dela.",
                  "O Admin cadastra os diretores e os clientes.",
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
