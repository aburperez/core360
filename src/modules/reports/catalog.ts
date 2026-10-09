/**
 * Relatórios da fase 6B: a lista que aparece na tela e o formato comum que
 * a folha (para salvar em PDF) e o Excel leem. Sem acesso ao banco: a tela
 * do navegador também importa daqui.
 */

export const REPORT_KEYS = ["book", "itens", "fornecedores", "montagem", "pendencias", "campo", "financeiro", "executivo"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORTS: Record<ReportKey, { title: string; description: string; director: boolean }> = {
  book: { title: "Book de produção", description: "Ficha, briefing, cronograma, itens, fornecedores, montagem e equipe num documento só.", director: false },
  itens: { title: "Master de itens", description: "Todos os itens do evento com categoria, área, status, fornecedor e prazo.", director: false },
  fornecedores: { title: "Mapa de fornecedores", description: "Quem foi contratado, para quais itens, com contato e situação do contrato.", director: false },
  montagem: { title: "Mapa de montagem", description: "As chegadas por dia e hora e os itens que precisam estar montados.", director: false },
  pendencias: { title: "Pendências", description: "O que está atrasado, vence hoje e nos próximos dias, com responsável.", director: false },
  campo: { title: "Relatório do campo", description: "Para a equipe de campo, sem valores: itens por área, chamados por equipe e quem é quem.", director: false },
  financeiro: { title: "Financeiro", description: "Os 4 valores por item, categoria e centro de custo, e os contratos.", director: true },
  executivo: { title: "Executivo", description: "Resumo para a diretoria: valores, economia, estouro, riscos e andamento.", director: true },
};

export const isReportKey = (k: string): k is ReportKey => (REPORT_KEYS as readonly string[]).includes(k);

export type Cell = string | number | null;
export type Column = { header: string; width: number; money?: boolean; number?: boolean };

export type Block =
  | { kind: "facts"; title: string; rows: [string, string][] }
  | { kind: "text"; title: string; rows: [string, string][] }
  | { kind: "table"; title: string; columns: Column[]; rows: Cell[][]; empty: string; note?: string };

export interface Report {
  key: ReportKey;
  title: string;
  eventName: string;
  /** "Gerado em 09/10/2026 14:30 por Marina". */
  generated: string;
  /** Tem valores em dinheiro (só o diretor recebe). */
  values: boolean;
  blocks: Block[];
}
