/** Central de documentos do evento: categorias (ordem do roadmap) e tamanho. */

export const DOCUMENT_CATEGORIES = [
  { key: "BRIEFING", label: "Briefing" },
  { key: "PLANTA", label: "Planta" },
  { key: "MEMORIAL", label: "Memorial descritivo" },
  { key: "MANUAL", label: "Manual do evento" },
  { key: "IDENTIDADE_VISUAL", label: "Identidade visual" },
  { key: "PROJETO_3D", label: "Projeto 3D" },
  { key: "ORCAMENTO_CLIENTE", label: "Orçamento do cliente" },
  { key: "CONTRATO", label: "Contratos" },
  { key: "PEDIDO", label: "Pedidos" },
  { key: "NOTA_FISCAL", label: "Notas fiscais" },
  { key: "ART_RRT", label: "ART/RRT" },
  { key: "LAUDO", label: "Laudos" },
  { key: "SEGURO", label: "Seguro" },
  { key: "CRONOGRAMA", label: "Cronograma" },
  { key: "MAPA", label: "Mapas" },
  { key: "CHECKLIST", label: "Checklists" },
  { key: "OUTRO", label: "Outros" },
] as const;

export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORIES)[number]["key"];
export const DOCUMENT_CATEGORY_LABEL = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.key, c.label])) as Record<DocumentCategoryKey, string>;

/** O que o seletor de arquivo aceita. */
export const DOCUMENT_ACCEPT = ".pdf,image/*,.heic,.docx,.xlsx,.pptx,.doc,.xls,.ppt";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
