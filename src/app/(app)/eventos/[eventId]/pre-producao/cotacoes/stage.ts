import type { QuoteStage } from "@/modules/quotes/quotes.service";

/** Como cada situação da cotação aparece nas telas. */
export const STAGE: Record<QuoteStage, { label: string; tone: string }> = {
  RASCUNHO: { label: "Ainda não enviada", tone: "bg-white/10 text-muted" },
  SEM_PRAZO: { label: "Aguardando prazo do gestor", tone: "bg-amber-400/15 text-amber-300" },
  NO_PRAZO: { label: "Recebendo orçamentos", tone: "bg-brand-cyan/15 text-brand-cyan" },
  ATRASADA: { label: "Prazo vencido", tone: "bg-red-500/15 text-red-300" },
  DECIDIR: { label: "Pronta para escolher", tone: "bg-violet-500/20 text-violet-200" },
  FECHADA: { label: "Fechada", tone: "bg-emerald-500/15 text-emerald-300" },
  CANCELADA: { label: "Cancelada", tone: "bg-white/5 text-muted line-through" },
};
