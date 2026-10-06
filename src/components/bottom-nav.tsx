"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function BottomNav({ eventId, canCreate, canSeeTickets, canBuildTeam }: { eventId: string; canCreate: boolean; canSeeTickets: boolean; canBuildTeam: boolean }) {
  const path = usePathname();
  const base = `/eventos/${eventId}`;
  const items = [
    { href: base, label: "Início", icon: "◉", active: path === base },
    // O Cliente não vê chamados (padrão da proposta), então o atalho some para ele.
    ...(canSeeTickets ? [{ href: `${base}/ocorrencias`, label: "Chamados", icon: "☰", active: path.startsWith(`${base}/ocorrencias`) && !path.endsWith("/nova") }] : []),
    ...(canCreate ? [{ href: `${base}/ocorrencias/nova`, label: "Novo", icon: "+", active: path.endsWith("/nova"), primary: true }] : []),
    { href: `${base}/equipe`, label: canBuildTeam ? "Montar equipe" : "Equipe", icon: "👥", active: path.startsWith(`${base}/equipe`) },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
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
                <span className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-3xl font-bold text-white shadow-lg">
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
  );
}
