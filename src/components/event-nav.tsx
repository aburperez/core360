"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandWordmark } from "./brand";
import { cx } from "./ui";

type NavProps = {
  eventId: string; canCreate: boolean; canSeeTickets: boolean; canBuildTeam: boolean; canSwitchEvent: boolean;
  /** Pré-produtor não tem campo; Head, Operacional e Cliente não têm Pré-produção. */
  canUseField: boolean; canUsePre: boolean;
  /** Itens da planilha enviados para conferir no campo (para esta pessoa, ou o gerente). */
  hasReceipts: boolean;
};

type Item = { href: string; label: string; icon: string; active: boolean; primary?: boolean };

/**
 * Navegação do evento, em duas abas: Gestão de campo e Pré-produção. No
 * celular é a barra fixa embaixo (com os itens da aba em que a pessoa está);
 * no computador (lg) vira um menu lateral com as duas abas. Esconder um atalho
 * é só conforto: quem decide o acesso é o servidor.
 */
export function EventNav(props: NavProps) {
  const path = usePathname();
  const base = `/eventos/${props.eventId}`;
  const pre = `${base}/pre-producao`;
  const inPre = path.startsWith(pre);
  const preItems: Item[] = [
    { href: pre, label: "Tipos e SLA", icon: "⏱", active: path === pre || path.startsWith(`${pre}/tipos`) },
    { href: `${pre}/quem-faz`, label: "Quem faz o quê", icon: "▦", active: path.startsWith(`${pre}/quem-faz`) },
    { href: `${pre}/custos`, label: "Custos", icon: "$", active: path.startsWith(`${pre}/custos`) },
  ];
  const items: Item[] = [
    { href: base, label: "Início", icon: "◉", active: path === base },
    // O Cliente não vê chamados (padrão da proposta), então o atalho some para ele.
    ...(props.canSeeTickets ? [{ href: `${base}/ocorrencias`, label: "Chamados", icon: "☰", active: path.startsWith(`${base}/ocorrencias`) && !path.endsWith("/nova") }] : []),
    ...(props.canCreate ? [{ href: `${base}/ocorrencias/nova`, label: "Novo", icon: "+", active: path.endsWith("/nova"), primary: true }] : []),
    { href: `${base}/equipe`, label: props.canBuildTeam ? "Montar equipe" : "Equipe", icon: "👥", active: path.startsWith(`${base}/equipe`) },
    ...(props.hasReceipts ? [{ href: `${base}/recebimentos`, label: "Recebimentos", icon: "📦", active: path.startsWith(`${base}/recebimentos`) }] : []),
  ];
  const create = items.find((it) => it.primary);
  const links = items.filter((it) => !it.primary);
  const mobile: Item[] = !props.canUseField ? preItems
    : inPre && props.canUsePre ? [...preItems, { href: base, label: "Campo", icon: "◉", active: false }]
    : items;

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-2xl">
          {mobile.map((it) => (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  it.active ? "text-primary" : "text-muted",
                )}
              >
                {it.primary ? (
                  <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-3xl font-bold text-accent-foreground shadow-lg ring-4 ring-surface">
                    +
                  </span>
                ) : (
                  <span className="text-xl leading-none" aria-hidden>{it.icon}</span>
                )}
                <span>{it.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/10 bg-brand-navy text-white lg:flex">
        <Link href={base} className="flex h-17 shrink-0 items-center px-6" aria-label="Início do evento">
          <BrandWordmark className="h-5 w-auto" />
        </Link>
        {create && props.canUseField && (
          <Link
            href={create.href}
            className="mx-4 mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-foreground transition hover:brightness-110"
          >
            <span className="text-xl leading-none" aria-hidden>+</span> Novo chamado
          </Link>
        )}
        <nav className="mt-4 flex-1 overflow-y-auto px-3">
          {props.canUseField && <SideGroup title="Gestão de campo" items={links} />}
          {props.canUsePre && <SideGroup title="Pré-produção" items={preItems} />}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-3">
          <Link href="/avisos" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-white/75 transition hover:bg-white/5 hover:text-white">
            <span className="w-6 text-center" aria-hidden>🔔</span> Avisos e WhatsApp
          </Link>
          {props.canSwitchEvent && (
            <Link href="/eventos?todos=1" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-white/75 transition hover:bg-white/5 hover:text-white">
              <span className="w-6 text-center" aria-hidden>⇄</span> Trocar de evento
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}

function SideGroup({ title, items }: { title: string; items: Item[] }) {
  return (
    <>
      <p className="mb-1 mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-white/50">{title}</p>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={it.active ? "page" : undefined}
              className={cx(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 font-medium transition",
                it.active ? "bg-white/10 text-brand-cyan" : "text-white/75 hover:bg-white/5 hover:text-white",
              )}
            >
              <span className="w-6 text-center text-lg leading-none" aria-hidden>{it.icon}</span>
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Abas Gestão de campo / Pré-produção no topo das telas iniciais (só no celular). */
export function EventTabs({ eventId, active }: { eventId: string; active: "campo" | "pre" }) {
  const tabs = [
    { key: "campo", label: "Gestão de campo", href: `/eventos/${eventId}` },
    { key: "pre", label: "Pré-produção", href: `/eventos/${eventId}/pre-producao` },
  ] as const;
  return (
    <nav aria-label="Abas do evento" className="border-b border-border bg-background lg:hidden">
      <ul className="mx-auto flex max-w-2xl px-4">
        {tabs.map((t) => (
          <li key={t.key} className="flex-1">
            <Link
              href={t.href}
              aria-current={active === t.key ? "page" : undefined}
              className={cx(
                "flex min-h-12 items-center justify-center border-b-2 text-sm font-semibold",
                active === t.key ? "border-primary text-primary" : "border-transparent text-muted",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
