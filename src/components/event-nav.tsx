"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandWordmark } from "./brand";
import { Icon, type IconName } from "./icons";
import { PAGE, cx } from "./ui";
import type { Section } from "@/server/authz/sections";

export type NavProps = {
  eventId: string; canCreate: boolean; canSeeTickets: boolean; canBuildTeam: boolean; canSwitchEvent: boolean;
  /** Pré-produtor não tem campo; Head, Operacional e Cliente não têm Pré-produção. */
  canUseField: boolean; canUsePre: boolean;
  /** Itens da planilha enviados para conferir no campo (para esta pessoa, ou o gerente). */
  hasReceipts: boolean;
  /** A pessoa tem briefing, função ou agenda (no celular fica no cartão da tela inicial). */
  hasBriefing: boolean;
  /** O gestor liberou documentos para o campo. */
  hasDocuments: boolean;
  /** Fornecedores contratados (o gestor e o Head da área). */
  canSeeSuppliers: boolean;
  /** Chegadas da montagem (o gestor, o Head e o Operacional responsável). */
  canSeeArrivals: boolean;
  /** As partes da Pré-produção que a pessoa abre (todas para o diretor e o Gerente de produção). */
  preSections: Section[];
  /** Cliente: o que o Gerente liberou para ele acompanhar (null para os outros). */
  client: { costs: boolean; team: boolean; progress: boolean } | null;
};

/** Ramo do menu em árvore do computador, como no Protheus. */
export type MenuGroup = "cad" | "mov" | "con" | "rel";

export type Item = {
  href: string; label: string; short?: string; icon: IconName; active: boolean; primary?: boolean; desktopOnly?: boolean; bar?: boolean;
  group: MenuGroup;
};

/** O botão ☰ do topo abre o menu lateral no celular por este evento. */
export const OPEN_MENU_EVENT = "core360:menu";

/**
 * As páginas do evento que esta pessoa pode abrir, por módulo. Usado pelo menu
 * do celular, pela árvore do computador e pelo caminho do topo. Esconder um
 * atalho é só conforto: quem decide o acesso é o servidor.
 */
export function buildNav(props: NavProps, path: string) {
  const base = `/eventos/${props.eventId}`;
  const pre = `${base}/pre-producao`;
  const inPre = path.startsWith(pre);
  const preItems: Item[] = ([
    { href: pre, label: "Painel", icon: "overview", active: path === pre, bar: true, group: "con" as const },
    { href: `${pre}/executivo`, label: "Painel executivo", short: "Executivo", icon: "chart" as const, active: path.startsWith(`${pre}/executivo`), group: "con" as const, section: "EXECUTIVO" },
    { href: `${pre}/briefing-evento`, label: "Briefing do evento", short: "Briefing", icon: "briefing", active: path.startsWith(`${pre}/briefing-evento`), group: "mov" as const, section: "BRIEFING" },
    { href: `${pre}/cronograma`, label: "Cronograma", icon: "calendar", active: path.startsWith(`${pre}/cronograma`), group: "mov" as const, section: "CRONOGRAMA" },
    { href: `${pre}/pendencias`, label: "Pendências", icon: "pending", active: path.startsWith(`${pre}/pendencias`), group: "mov" as const, section: "PENDENCIAS" },
    { href: `${pre}/montagem`, label: "Mapa de montagem", short: "Montagem", icon: "truck", active: path.startsWith(`${pre}/montagem`), group: "mov" as const, section: "MONTAGEM" },
    { href: `${pre}/tipos`, label: "Tipos e SLA", short: "Tipos", icon: "sla", active: path.startsWith(`${pre}/tipos`), bar: true, group: "cad" as const, section: "TIPOS" },
    { href: `${pre}/itens`, label: "Mapa de itens", short: "Itens", icon: "items", active: path.startsWith(`${pre}/itens`), group: "mov" as const, section: "ITENS" },
    { href: `${pre}/orcamento`, label: "Orçamento", icon: "costs", active: path.startsWith(`${pre}/orcamento`) || path.startsWith(`${pre}/custos`), bar: true, group: "mov" as const, section: "ORCAMENTO" },
    { href: `${pre}/financeiro`, label: "Fechamento financeiro", short: "Financeiro", icon: "costs", active: path.startsWith(`${pre}/financeiro`), group: "mov" as const, section: "FINANCEIRO" },
    { href: `${pre}/cotacoes`, label: "Cotações", icon: "quotes", active: path.startsWith(`${pre}/cotacoes`), group: "mov" as const, section: "COTACOES" },
    { href: `${pre}/fornecedores`, label: "Fornecedores", icon: "suppliers", active: path.startsWith(`${pre}/fornecedores`), group: "cad" as const, section: "COTACOES" },
    { href: `${pre}/contratos`, label: "Contratos", icon: "contract", active: path.startsWith(`${pre}/contratos`), group: "mov" as const, section: "COTACOES" },
    { href: `${pre}/visitas`, label: "Visitas técnicas", short: "Visitas", icon: "visit", active: path.startsWith(`${pre}/visitas`), group: "mov" as const, section: "VISITAS" },
    { href: `${pre}/documentos`, label: "Documentos", short: "Docs", icon: "docs", active: path.startsWith(`${pre}/documentos`), group: "mov" as const, section: "DOCUMENTOS" },
    { href: `${pre}/funcoes`, label: "Produtores e Funções", short: "Produtores", icon: "functions", active: path.startsWith(`${pre}/funcoes`) || path.startsWith(`${pre}/quem-faz`) || (path.startsWith(`${pre}/briefing`) && !path.startsWith(`${pre}/briefing-evento`)), bar: true, group: "cad" as const, section: "FUNCOES" },
    { href: `${pre}/atendimento`, label: "Atendimento", icon: "team", active: path.startsWith(`${pre}/atendimento`), group: "cad" as const, section: "ATENDIMENTO" },
    { href: `${pre}/relatorios`, label: "Relatórios", short: "Relatórios", icon: "report", active: path.startsWith(`${pre}/relatorio`), group: "rel" as const, section: "RELATORIOS" },
  ] as (Item & { section?: Section })[]).filter((it) => !it.section || props.preSections.includes(it.section));
  const items: Item[] = [
    { href: base, label: "Painel", icon: "overview", active: path === base, group: "con" as const },
    // O Cliente não vê chamados (padrão da proposta), então o atalho some para ele.
    ...(props.canSeeTickets ? [{ href: `${base}/ocorrencias`, label: "Chamados", icon: "tickets" as const, active: path.startsWith(`${base}/ocorrencias`) && !path.endsWith("/nova"), group: "mov" as const }] : []),
    ...(props.canCreate ? [{ href: `${base}/ocorrencias/nova`, label: "Novo", icon: "plus" as const, active: path.endsWith("/nova"), primary: true, group: "mov" as const }] : []),
    { href: `${base}/planta`, label: "Planta do evento", short: "Planta", icon: "map", active: path.startsWith(`${base}/planta`), group: "cad" as const },
    ...(props.canSeeArrivals ? [{ href: `${base}/montagem`, label: "Montagem", icon: "truck" as const, active: path.startsWith(`${base}/montagem`), desktopOnly: true, group: "mov" as const }] : []),
    { href: `${base}/equipe`, label: props.canBuildTeam ? "Montar equipe" : "Equipe", short: "Equipe", icon: "team", active: path.startsWith(`${base}/equipe`), group: "cad" as const },
    // Na barra de baixo cabem cinco: os recebimentos ficam no menu ☰ e no aviso do painel.
    ...(props.hasReceipts ? [{ href: `${base}/recebimentos`, label: "Recebimentos", short: "Receber", icon: "receipts" as const, active: path.startsWith(`${base}/recebimentos`), desktopOnly: true, group: "mov" as const }] : []),
    ...(props.canSeeSuppliers ? [{ href: `${base}/fornecedores`, label: "Fornecedores", icon: "suppliers" as const, active: path.startsWith(`${base}/fornecedores`), desktopOnly: true, group: "con" as const }] : []),
    ...(props.hasDocuments ? [{ href: `${base}/documentos`, label: "Documentos", short: "Docs", icon: "docs" as const, active: path.startsWith(`${base}/documentos`), desktopOnly: true, group: "mov" as const }] : []),
    ...(props.hasBriefing ? [{ href: `${base}/briefing`, label: "Meu briefing", short: "Briefing", icon: "briefing" as const, active: path.startsWith(`${base}/briefing`), desktopOnly: true, group: "con" as const }] : []),
  ];
  // O Cliente só acompanha: a tela inicial e o que foi liberado para ele.
  const c = props.client;
  const clientItems: Item[] | null = c
    ? [
        { href: base, label: "Acompanhamento", short: "Início", icon: "overview", active: path === base, group: "con" as const },
        ...(c.progress
          ? [
              { href: `${base}/ocorrencias`, label: "Chamados", icon: "tickets" as const, active: path.startsWith(`${base}/ocorrencias`), group: "con" as const },
              { href: `${base}/planta`, label: "Planta do evento", short: "Planta", icon: "map" as const, active: path.startsWith(`${base}/planta`), group: "con" as const },
            ]
          : []),
        ...(c.team ? [{ href: `${base}/equipe`, label: "Equipe", icon: "team" as const, active: path.startsWith(`${base}/equipe`), group: "con" as const }] : []),
        ...(c.costs ? [{ href: `${base}/custos`, label: "Custos", icon: "costs" as const, active: path.startsWith(`${base}/custos`), group: "con" as const }] : []),
      ]
    : null;
  return { base, pre, inPre, preItems, items, clientItems };
}

/**
 * Navegação do evento, em dois blocos: Gestão de campo e Pré-produção. Cada
 * bloco abre o seu painel e lista as páginas com ícone. No celular o menu abre pelo ☰
 * do topo; no computador fica sempre aberto à esquerda, em árvore (estilo
 * Protheus), com a barra de status embaixo. No dia a dia a pessoa navega pelos cartões de
 * cada painel. No celular a barra de baixo fica com os atalhos do bloco em que a
 * pessoa está. Esconder um atalho é
 * só conforto: quem decide o acesso é o servidor.
 */
export function EventNav(props: NavProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { base, pre, inPre, preItems, items, clientItems } = buildNav(props, path);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, show);
    return () => window.removeEventListener(OPEN_MENU_EVENT, show);
  }, []);
  // Fecha ao trocar de página.
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setOpen(false);
  }

  const create = items.find((it) => it.primary);
  const links = items.filter((it) => !it.primary);
  const bar: Item[] = clientItems ? clientItems
    : !props.canUseField ? preItems.filter((it) => it.bar)
    : inPre && props.canUsePre ? [...preItems.filter((it) => it.bar), { href: base, label: "Campo", icon: "field", active: false, group: "con" }]
    : items.filter((it) => !it.desktopOnly);

  const menu = (
    <SideMenu
      {...props}
      base={base}
      pre={pre}
      inPre={inPre}
      fieldItems={links}
      preItems={preItems}
      clientItems={clientItems}
      create={create}
      onClose={open ? () => setOpen(false) : undefined}
    />
  );

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-2xl">
          {bar.map((it) => (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={it.active ? "page" : undefined}
                className={cx("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", it.active ? "text-primary" : "text-muted")}
              >
                {it.primary ? (
                  <span className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg ring-4 ring-surface">
                    <Icon name="plus" className="h-7 w-7" />
                  </span>
                ) : (
                  <span className={cx("flex h-9 w-9 items-center justify-center rounded-full transition", it.active ? "bg-primary/15" : "bg-white/5")}>
                    <Icon name={it.icon} className="h-5 w-5" />
                  </span>
                )}
                <span>{it.short ?? it.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu do evento">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-brand-navy pt-[env(safe-area-inset-top)] text-white shadow-2xl">{menu}</aside>
        </div>
      )}
    </>
  );
}

function SideMenu(
  props: NavProps & {
    base: string; pre: string; inPre: boolean; fieldItems: Item[]; preItems: Item[]; clientItems: Item[] | null; create?: Item; onClose?: () => void;
  },
) {
  return (
    <>
      <div className="flex h-17 shrink-0 items-center justify-between px-6">
        <Link href={props.base} aria-label="Painel do evento">
          <BrandWordmark className="h-5 w-auto" />
        </Link>
        {props.onClose && (
          <button type="button" onClick={props.onClose} aria-label="Fechar menu" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10">
            <Icon name="close" />
          </button>
        )}
      </div>
      {props.create && props.canUseField && (
        <Link
          href={props.create.href}
          className="mx-4 mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-foreground transition hover:brightness-110"
        >
          <Icon name="plus" className="h-5 w-5" /> Novo chamado
        </Link>
      )}
      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3">
        {props.clientItems && (
          <SideGroup title="Acompanhamento" icon="overview" href={props.base} current items={props.clientItems.filter((it) => it.href !== props.base)} />
        )}
        {props.canUseField && (
          <SideGroup title="Gestão de campo" icon="field" href={props.base} current={!props.inPre} items={props.fieldItems} />
        )}
        {props.canUsePre && (
          <SideGroup title="Pré-produção" icon="pre" href={props.pre} current={props.inPre} items={props.preItems.filter((it) => it.href !== props.pre)} />
        )}
      </nav>
      <div className="space-y-1 border-t border-white/10 p-3">
        <FooterLink href="/avisos" icon="bell">Avisos e WhatsApp</FooterLink>
        {props.canSwitchEvent && <FooterLink href="/eventos?todos=1" icon="swap">Trocar de evento</FooterLink>}
      </div>
    </>
  );
}

/** Bloco do menu: o título leva ao painel; embaixo, as páginas com ícone. */
function SideGroup({ title, icon, href, current, items }: { title: string; icon: IconName; href: string; current: boolean; items: Item[] }) {
  return (
    <div className="mt-4">
      <Link
        href={href}
        className={cx(
          "flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold transition",
          current ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5 hover:text-white",
        )}
      >
        <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg", current ? "bg-brand-cyan text-brand-navy" : "bg-white/10")}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="flex-1 whitespace-nowrap">{title}</span>
      </Link>
      <ul className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-2">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={cx(
                "flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
                it.active ? "bg-white/10 text-brand-cyan" : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon name={it.icon} className="h-[18px] w-[18px]" />
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterLink({ href, icon, children }: { href: string; icon: IconName; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-white/75 transition hover:bg-white/5 hover:text-white">
      <Icon name={icon} className="h-5 w-5" /> {children}
    </Link>
  );
}

/** Abas Gestão de campo / Pré-produção no topo dos painéis, como um botão de duas partes. */
export function EventTabs({ eventId, active }: { eventId: string; active: "campo" | "pre" }) {
  const tabs = [
    { key: "campo", label: "Gestão de campo", icon: "field", href: `/eventos/${eventId}` },
    { key: "pre", label: "Pré-produção", icon: "pre", href: `/eventos/${eventId}/pre-producao` },
  ] as const;
  return (
    <nav aria-label="Abas do evento" className={cx(PAGE, "print:hidden pt-2 lg:hidden")}>
      <ul className="mx-auto flex max-w-2xl rounded-full border border-border bg-surface p-1 lg:mx-0 lg:max-w-md">
        {tabs.map((t) => (
          <li key={t.key} className="flex-1">
            <Link
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={cx(
                "flex min-h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold transition",
                active === t.key ? "bg-primary text-primary-foreground" : "text-muted",
              )}
            >
              <Icon name={t.icon} className="h-4 w-4" />
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
