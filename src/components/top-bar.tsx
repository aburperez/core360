import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ConnectionBanner } from "./connection-banner";
import { NotificationBell } from "./notification-bell";
import { BrandWordmark } from "./brand";

/** Barra do topo na cor da marca. `brand` mostra o logo no lugar do título (tela inicial). */
export function TopBar({ title, subtitle, back, brand }: { title: string; subtitle?: string; back?: string; brand?: boolean }) {
  return (
    <header className="sticky top-0 z-20 bg-brand-navy text-white pt-[env(safe-area-inset-top)]">
      <ConnectionBanner />
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        {back && (
          <Link href={back} aria-label="Voltar" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-2xl text-white">
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
