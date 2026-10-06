import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ConnectionBanner } from "./connection-banner";

export function TopBar({ title, subtitle, back }: { title: string; subtitle?: string; back?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur pt-[env(safe-area-inset-top)]">
      <ConnectionBanner />
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
        {back && (
          <Link href={back} aria-label="Voltar" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-2xl">
            ‹
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
