"use client";

import { useState } from "react";

/**
 * Link de convite pronto, com os botões para mandar. Cada envio é um toque da
 * própria pessoa: o iPhone e o Safari recusam compartilhar ou copiar depois de
 * esperar o servidor, então nada é disparado sozinho ao criar o convite.
 */
export function InviteShare({ url, name, as, note = "vale 7 dias e só pode ser usado uma vez" }: {
  url: string; name: string; as?: string; note?: string;
}) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = `${name}, este é seu acesso${as ? ` de ${as}` : ""} ao CORE 360:`;
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const btn = "rounded-lg border px-3 py-1.5 text-sm font-medium";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-background p-3">
      <p className="text-sm">Convite pronto para <b>{name}</b> ({note}). Mande por um destes:</p>
      <div className="flex flex-wrap gap-2">
        {canShare && (
          <button type="button" className={`${btn} border-primary text-primary`}
            onClick={() => navigator.share({ title: "Acesso CORE 360", text, url }).catch(() => {})}>
            Compartilhar
          </button>
        )}
        <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener" className={`${btn} border-border`}>
          WhatsApp
        </a>
        <button type="button" className={`${btn} border-border`} onClick={copy}>
          {copied ? "Link copiado ✓" : "Copiar link"}
        </button>
      </div>
      {copied === false && <p className="text-xs text-amber-300">Não deu para copiar sozinho. Segure o link abaixo e copie.</p>}
      <p className="select-all break-all text-xs text-muted">{url}</p>
    </div>
  );
}
