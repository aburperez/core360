/* eslint-disable @next/next/no-img-element */

/** Logo completo (anel de pontos + CORE360) sobre o azul-marinho da marca. Telas de entrada. */
export function BrandHero({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-brand-navy px-5 pb-8 pt-[calc(env(safe-area-inset-top)+2rem)] text-white">
      <div className="mx-auto max-w-sm text-center">
        <img src="/brand/core360-logo.png" alt="CORE 360" width={240} height={161} className="mx-auto h-auto w-60" />
        {children}
      </div>
    </div>
  );
}

/** Só o nome CORE360, para a barra do topo. Feito para fundo escuro. */
export function BrandWordmark({ className }: { className?: string }) {
  return <img src="/brand/core360-wordmark.png" alt="CORE 360" width={128} height={20} className={className ?? "h-5 w-auto"} />;
}
