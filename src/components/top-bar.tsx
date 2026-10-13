import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ConnectionBanner } from "./connection-banner";
import { NotificationBell } from "./notification-bell";
import { BrandWordmark } from "./brand";
import { MenuButton } from "./menu-button";
import { Icon } from "./icons";
import { PAGE, cx } from "./ui";

/**
 * Topo de todas as telas, no estilo da grade de pastas: a barra da marca de
 * ponta a ponta (☰, logo, avisos e sair) e, embaixo, a linha do caminho com o
 * nome da tela. `back` vira a seta de voltar; sem ela, a casinha leva a Meus eventos.
 * `narrow` mantém a coluna estreita (telas fora do evento, como Avisos).
 * `brand` ficou só por compatibilidade: o logo agora aparece sempre.
 */
export function TopBar({ title, subtitle, back, narrow }: { title: string; subtitle?: string; back?: string; brand?: boolean; narrow?: boolean }) {
  return (
    <>
      <header className="sticky top-0 z-20 print:hidden bg-brand-navy text-white pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgba(255,255,255,0.06)]">
        <ConnectionBanner />
        <div className="flex h-15 items-center gap-1 px-3 lg:gap-2 lg:px-5">
          <MenuButton />
          <Link href="/eventos" aria-label="Meus eventos" className="ml-1 mr-auto rounded-lg py-2 pr-2">
            <BrandWordmark className="h-[22px] w-auto" />
          </Link>
          <NotificationBell />
          <LogoutButton />
        </div>
      </header>
      <nav aria-label="Caminho" className={cx("flex min-h-11 items-center gap-1.5 pt-3 text-sm print:hidden", narrow ? "mx-auto max-w-2xl px-4" : PAGE)}>
        {back ? (
          <Link href={back} aria-label="Voltar" className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-muted transition hover:bg-white/5 hover:text-foreground">
            ‹
          </Link>
        ) : (
          <Link href="/eventos" aria-label="Meus eventos" className="-ml-1 flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:text-foreground">
            <Icon name="home" className="h-[18px] w-[18px]" />
          </Link>
        )}
        <span className="text-muted" aria-hidden>›</span>
        <h1 className="min-w-0 truncate font-semibold">{title}</h1>
        {subtitle && <span className="hidden min-w-0 truncate text-muted sm:inline">· {subtitle}</span>}
      </nav>
    </>
  );
}
