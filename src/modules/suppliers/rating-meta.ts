/** Os 6 critérios da avaliação (0 a 10), na ordem das telas. Sem nada do servidor: o navegador também usa. */
export const RATING_CRITERIA = [
  { key: "quality", label: "Qualidade" },
  { key: "deadline", label: "Prazo" },
  { key: "service", label: "Atendimento" },
  { key: "cost", label: "Custo" },
  { key: "flexibility", label: "Flexibilidade" },
  { key: "problemSolving", label: "Solução de problemas" },
] as const;
export type RatingKey = (typeof RATING_CRITERIA)[number]["key"];

/** Eventos em que a avaliação está aberta. */
export const RATING_OPEN_STATUSES = ["FECHAMENTO", "CONCLUIDO"] as const;

export const ratingText = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
