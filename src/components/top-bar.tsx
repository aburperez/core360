import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ConnectionBanner } from "./connection-banner";
import { NotificationBell } from "./notification-bell";
import { BrandWordmark } from "./brand";
import { PAGE, cx } from "./ui";

/**
 * Barra do topo na cor da marca. `brand` mostra o logo no lugar do título (tela inicial).
 * `narrow` mantém a coluna estreita no computador (telas fora do evento, como Avisos).
 */
export function TopBar({ title, subtitle, back, brand, narrow }: { title: string; subtitle?: string; back?: string; brand?: boolean; narrow?: boolean }) {
  return (
    <header className="sticky top-0 z-20 bg-brand-navy text-white pt-[env(safe-area-inset-top)]">
      <ConnectionBanner />
      <div className={cx("flex items-center gap-2 py-3", narrow ? "mx-auto max-w-2xl px-4" : PAGE)}>
        {back && (
          <Link href={back} aria-label="Voltar" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-2xl text-white transition hover:bg-white/10">
            ‹
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {brand ? (
            <>
              <h1 className="sr-only">{title}</h1>
              <BrandWordmark className="h-5 w-auto" />
            </>
          ) : (
            <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          )}
          {subtitle && <p className={`truncate text-sm text-white/70 ${brand ? "mt-1" : ""}`}>{subtitle}</p>}
        </div>
        <NotificationBell />
        <LogoutButton />
      </div>
    </header>
  );
}
