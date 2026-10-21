/**
 * As partes da Pré-produção (hierarquia de acessos, 2026-10-20). O diretor e o
 * Gerente de produção entram em todas; o Produtor executivo, nas fixas dele; o
 * Pré-produtor, nas caixas marcadas para ele. Espelha app.all_sections(),
 * app.executive_sections() e app.has_section() da migration
 * *_acessos_pre_producao.
 */
export const SECTIONS = [
  "EXECUTIVO",
  "BRIEFING",
  "FUNCOES",
  "ATENDIMENTO",
  "PENDENCIAS",
  "CRONOGRAMA",
  "MONTAGEM",
  "TIPOS",
  "ITENS",
  "ORCAMENTO",
  "FINANCEIRO",
  "COTACOES",
  "VISITAS",
  "DOCUMENTOS",
  "RELATORIOS",
] as const;

export type Section = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<Section, string> = {
  EXECUTIVO: "Painel executivo",
  BRIEFING: "Briefing do evento",
  FUNCOES: "Produtores e Funções",
  ATENDIMENTO: "Atendimento",
  PENDENCIAS: "Pendências",
  CRONOGRAMA: "Cronograma",
  MONTAGEM: "Mapa de montagem",
  TIPOS: "Tipos e SLA",
  ITENS: "Mapa de itens",
  ORCAMENTO: "Orçamento",
  FINANCEIRO: "Fechamento financeiro",
  COTACOES: "Cotações e fornecedores",
  VISITAS: "Visitas técnicas",
  DOCUMENTOS: "Documentos",
  RELATORIOS: "Relatórios",
};

/** O que cada caixa libera, numa linha (tela de caixas de acesso). */
export const SECTION_HINT: Record<Section, string> = {
  EXECUTIVO: "Os 4 valores, economia, estouro e riscos",
  BRIEFING: "O que o cliente pediu e as frentes de estrutura",
  FUNCOES: "Funções, agenda, ficha e briefing de cada pessoa",
  ATENDIMENTO: "O que o Cliente vê do evento",
  PENDENCIAS: "Tarefas da preparação",
  CRONOGRAMA: "Marcos até o evento",
  MONTAGEM: "Chegadas dos fornecedores na montagem",
  TIPOS: "Tipos de chamado, SLA e quem atende",
  ITENS: "Itens do evento, sem os valores",
  ORCAMENTO: "Planilha com os valores",
  FINANCEIRO: "Pagamentos e fechamento",
  COTACOES: "Cotações, propostas, contratos e fornecedores",
  VISITAS: "Visitas técnicas ao local",
  DOCUMENTOS: "Arquivos do evento",
  RELATORIOS: "Book, itens, fornecedores e mais, em PDF e Excel",
};

/** As partes fixas do Produtor executivo. */
export const EXECUTIVE_SECTIONS: readonly Section[] = [
  "FUNCOES", "ORCAMENTO", "FINANCEIRO", "EXECUTIVO", "BRIEFING", "ITENS", "MONTAGEM", "DOCUMENTOS", "ATENDIMENTO",
];

/** As caixas que o Head marca nos produtores da área dele. As de valores e do cliente ficam com o gestor. Espelha app.head_sections(). */
export const HEAD_SECTIONS: readonly Section[] = SECTIONS.filter((s) => s !== "EXECUTIVO" && s !== "ORCAMENTO" && s !== "FINANCEIRO" && s !== "ATENDIMENTO");

/** O que o Pré-produtor abria antes das caixas (a migration liberou isto para os que já existiam). */
export const LEGACY_PRODUCER_SECTIONS: readonly Section[] = SECTIONS.filter((s) => s !== "EXECUTIVO" && s !== "FINANCEIRO" && s !== "ATENDIMENTO");

export function isSection(v: unknown): v is Section {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
}
