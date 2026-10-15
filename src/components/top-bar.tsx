"use client";

import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ConnectionBanner } from "./connection-banner";
import { NotificationBell } from "./notification-bell";
import { BrandWordmark } from "./brand";
import { MenuButton } from "./menu-button";
import { Icon } from "./icons";
import { HeaderInfo, MenuCrumb, ModuleSwitcher, OpenTabs } from "./desktop-shell";
import { useEventShell } from "./shell-context";
import { PAGE, cx } from "./ui";

/**
 * Topo de todas as telas. No celular: a barra da marca de ponta a ponta (☰,
 * logo, avisos e sair) e, embaixo, a linha do caminho com o nome da tela.
 * No computador, dentro de um evento, vira o topo estilo Protheus: módulo (que
 * troca de módulo), cliente, evento, data base e pessoa; embaixo, as abas das
 * telas abertas e o título com o caminho no menu. O logo fica na árvore à esquerda.
 * `back` vira a seta de voltar; sem ela, a casinha leva a Meus eventos.
 * `narrow` mantém a coluna estreita (telas fora do evento, como Avisos).
 * `brand` ficou só por compatibilidade: o logo agora aparece sempre.
 */
export function TopBar({ title, subtitle, back, narrow }: { title: string; subtitle?: string; back?: string; brand?: boolean; narrow?: boolean }) {
  const shell = useEventShell();
  return (
    <>
      <header className="sticky top-0 z-20 print:hidden bg-brand-navy text-white pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgba(255,255,255,0.06)]">
        <ConnectionBanner />
        <div className={cx("flex h-15 items-center gap-1 px-3 lg:gap-2 lg:px-5", shell && "lg:h-11 lg:gap-3 lg:px-3")}>
          <span className={cx(shell && "lg:hidden")}>
            <MenuButton />
          </span>
          <Link href="/eventos" aria-label="Meus eventos" className={cx("ml-1 mr-auto rounded-lg py-2 pr-2", shell && "lg:hidden")}>
            <BrandWordmark className="h-[22px] w-auto" />
          </Link>
          {shell && (
            <div className="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
              <ModuleSwitcher />
              <span className="ml-auto" />
              <HeaderInfo />
            </div>
          )}
          <NotificationBell />
          <LogoutButton />
        </div>
      </header>
      {shell && <OpenTabs title={title} />}
      <nav
        aria-label="Caminho"
        className={cx("flex min-h-11 items-center gap-1.5 pt-3 text-sm print:hidden", narrow ? "mx-auto max-w-2xl px-4" : PAGE, shell && "lg:gap-2.5")}
      >
        {back ? (
          <Link href={back} aria-label="Voltar" className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-muted transition hover:bg-white/5 hover:text-foreground">
            ‹
          </Link>
        ) : (
          <Link
            href="/eventos"
            aria-label="Meus eventos"
            className={cx("-ml-1 flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:text-foreground", shell && "lg:hidden")}
          >
            <Icon name="home" className="h-[18px] w-[18px]" />
          </Link>
        )}
        <span className={cx("text-muted", shell && "lg:hidden")} aria-hidden>
          ›
        </span>
        <h1 className={cx("min-w-0 truncate font-semibold", shell && "lg:text-[17px]")}>{title}</h1>
        {subtitle && <span className={cx("hidden min-w-0 truncate text-muted sm:inline", shell && "lg:hidden")}>· {subtitle}</span>}
        {shell && <MenuCrumb />}
      </nav>
    </>
  );
}
