/**
 * Item do evento (fase 2 do roadmap): rótulos, código e regras de status.
 * Sem nada do servidor: as telas usam os mesmos nomes e regras. As regras de
 * quem muda o quê valem também no banco (gatilho cost_items_guard).
 */

export const ITEM_STATUSES = [
  "A_DEFINIR", "EM_COTACAO", "COTACAO_RECEBIDA", "EM_APROVACAO", "APROVADO", "CONTRATADO",
  "EM_PRODUCAO", "PRONTO", "EM_TRANSPORTE", "NO_LOCAL", "MONTADO", "CONFERIDO", "FINALIZADO",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  A_DEFINIR: "A definir",
  EM_COTACAO: "Em cotação",
  COTACAO_RECEBIDA: "Cotação recebida",
  EM_APROVACAO: "Em aprovação",
  APROVADO: "Aprovado",
  CONTRATADO: "Contratado",
  EM_PRODUCAO: "Em produção",
  PRONTO: "Pronto",
  EM_TRANSPORTE: "Em transporte",
  NO_LOCAL: "No local",
  MONTADO: "Montado",
  CONFERIDO: "Conferido",
  FINALIZADO: "Finalizado",
};

/** Status que só o diretor de produção põe (os do campo chegam sozinhos pela conferência). */
const DIRECTOR_ONLY: ItemStatus[] = ["APROVADO", "CONTRATADO", "NO_LOCAL", "MONTADO", "CONFERIDO", "FINALIZADO"];
const rank = (s: ItemStatus) => ITEM_STATUSES.indexOf(s);

/**
 * A Pré-produção move o item entre os seus status (A definir até Em
 * transporte); não põe nem tira dos status do diretor e do campo, nem volta
 * um item aprovado para antes da aprovação. O diretor muda para qualquer um.
 */
export function canSetItemStatus(from: ItemStatus, to: ItemStatus, director: boolean) {
  if (from === to) return true;
  if (director) return true;
  if (DIRECTOR_ONLY.includes(to)) return false;
  if (rank(from) >= rank("NO_LOCAL")) return false;
  if ((from === "APROVADO" || from === "CONTRATADO") && rank(to) < rank("APROVADO")) return false;
  return true;
}

/** Cor do selo do status, por fase do fluxo. */
export function itemStatusTone(s: ItemStatus): "muted" | "warn" | "info" | "ok" | "done" {
  const r = rank(s);
  if (s === "A_DEFINIR") return "muted";
  if (r < rank("APROVADO")) return "warn";
  if (r < rank("NO_LOCAL")) return "info";
  if (s === "FINALIZADO") return "done";
  return "ok";
}

export const ITEM_CATEGORIES = [
  "INFRAESTRUTURA", "CENOGRAFIA", "TECNICA", "AUDIOVISUAL", "ILUMINACAO", "MOBILIARIO", "COMUNICACAO_VISUAL",
  "RECURSOS_HUMANOS", "SEGURANCA", "LIMPEZA", "TRANSPORTE", "HOSPEDAGEM", "ALIMENTACAO", "LOGISTICA", "LOCACAO",
  "TAXAS", "PRODUCAO", "CONTINGENCIA",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const COST_CENTERS = ["INFRA", "CENO", "TECNICA", "OPERACAO", "LOGISTICA", "STAFF", "PRODUCAO", "ADMINISTRATIVO"] as const;
export type CostCenter = (typeof COST_CENTERS)[number];

export const COST_CENTER_LABEL: Record<CostCenter, string> = {
  INFRA: "01 INFRA",
  CENO: "02 CENO",
  TECNICA: "03 TÉCNICA",
  OPERACAO: "04 OPERAÇÃO",
  LOGISTICA: "05 LOGÍSTICA",
  STAFF: "06 STAFF",
  PRODUCAO: "07 PRODUÇÃO",
  ADMINISTRATIVO: "08 ADMINISTRATIVO",
};

/** Nome, sigla do código e centro de custo padrão de cada categoria. */
export const CATEGORY: Record<ItemCategory, { label: string; code: string; center: CostCenter }> = {
  INFRAESTRUTURA: { label: "Infraestrutura", code: "INF", center: "INFRA" },
  CENOGRAFIA: { label: "Cenografia", code: "CEN", center: "CENO" },
  TECNICA: { label: "Técnica", code: "TEC", center: "TECNICA" },
  AUDIOVISUAL: { label: "Audiovisual", code: "AUD", center: "TECNICA" },
  ILUMINACAO: { label: "Iluminação", code: "ILU", center: "TECNICA" },
  MOBILIARIO: { label: "Mobiliário", code: "MOB", center: "CENO" },
  COMUNICACAO_VISUAL: { label: "Comunicação Visual", code: "COM", center: "CENO" },
  RECURSOS_HUMANOS: { label: "Recursos Humanos", code: "RHU", center: "STAFF" },
  SEGURANCA: { label: "Segurança", code: "SEG", center: "OPERACAO" },
  LIMPEZA: { label: "Limpeza", code: "LIM", center: "OPERACAO" },
  TRANSPORTE: { label: "Transporte", code: "TRA", center: "LOGISTICA" },
  HOSPEDAGEM: { label: "Hospedagem", code: "HOS", center: "LOGISTICA" },
  ALIMENTACAO: { label: "Alimentação", code: "ALI", center: "OPERACAO" },
  LOGISTICA: { label: "Logística", code: "LOG", center: "LOGISTICA" },
  LOCACAO: { label: "Locação", code: "LOC", center: "INFRA" },
  TAXAS: { label: "Taxas", code: "TAX", center: "ADMINISTRATIVO" },
  PRODUCAO: { label: "Produção", code: "PRO", center: "PRODUCAO" },
  CONTINGENCIA: { label: "Contingência", code: "CTG", center: "ADMINISTRATIVO" },
};

/** Sem categoria ainda: o código usa GER (geral) até alguém escolher. */
export const NO_CATEGORY_CODE = "GER";

const pad = (n: number) => String(n).padStart(3, "0");

/** EVT001-CEN-023: número do evento na agência, sigla da categoria, número do item no evento. */
export function itemCode(eventNumber: number, category: ItemCategory | null, itemNumber: number) {
  return `EVT${pad(eventNumber)}-${category ? CATEGORY[category].code : NO_CATEGORY_CODE}-${pad(itemNumber)}`;
}

/** Centro de custo do item: o escolhido pelo diretor ou o da categoria. */
export function effectiveCostCenter(category: ItemCategory | null, override: CostCenter | null): CostCenter | null {
  return override ?? (category ? CATEGORY[category].center : null);
}

/** Unidades mais usadas (a pessoa pode digitar outra). */
export const COMMON_UNITS = ["UN", "m²", "m", "diária", "hora", "pessoa", "kit", "lote", "verba"];
