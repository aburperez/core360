"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandWordmark } from "./brand";
import { cx } from "./ui";

type NavProps = { eventId: string; canCreate: boolean; canSeeTickets: boolean; canBuildTeam: boolean; canSwitchEvent: boolean };

/**
 * Navegação do evento. No celular é a barra fixa embaixo; no computador (lg)
 * vira um menu lateral. Os itens são os mesmos nos dois: esconder um atalho
 * é só conforto, quem decide o acesso é o servidor.
 */
export function EventNav(props: NavProps) {
  const path = usePathname();
  const base = `/eventos/${props.eventId}`;
  const items = [
    { href: base, label: "Início", icon: "◉", active: path === base },
    // O Cliente não vê chamados (padrão da proposta), então o atalho some para ele.
    ...(props.canSeeTickets ? [{ href: `${base}/ocorrencias`, label: "Chamados", icon: "☰", active: path.startsWith(`${base}/ocorrencias`) && !path.endsWith("/nova") }] : []),
    ...(props.canCreate ? [{ href: `${base}/ocorrencias/nova`, label: "Novo", icon: "+", active: path.endsWith("/nova"), primary: true }] : []),
    { href: `${base}/equipe`, label: props.canBuildTeam ? "Montar equipe" : "Equipe", icon: "👥", active: path.startsWith(`${base}/equipe`) },
  ];
  const create = items.find((it) => "primary" in it);
  const links = items.filter((it) => !("primary" in it));

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-2xl">
          {items.map((it) => (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  it.active ? "text-primary" : "text-muted",
                )}
              >
                {"primary" in it && it.primary ? (
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
        {create && (
          <Link
            href={create.href}
            className="mx-4 mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-foreground transition hover:brightness-110"
          >
            <span className="text-xl leading-none" aria-hidden>+</span> Novo chamado
          </Link>
        )}
        <nav className="mt-6 flex-1 px-3">
          <ul className="space-y-1">
            {links.map((it) => (
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
