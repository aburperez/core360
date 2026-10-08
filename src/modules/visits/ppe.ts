/**
 * EPIs (equipamentos de proteção individual). Lista fixa para marcar na visita
 * técnica e a lista básica da montagem, que aparece na Pré-produção e no
 * "Meu briefing" de quem é do campo. Sem banco: pode ser usada na tela.
 */

/** O que dá para marcar como necessário numa visita técnica. */
export const PPE_OPTIONS = [
  "Capacete",
  "Calça comprida",
  "Camiseta",
  "Sapato de proteção",
  "Protetor auricular",
  "Colete refletivo",
  "Luvas",
  "Óculos de proteção",
  "Cinto de segurança (trabalho em altura)",
] as const;

export type PpeName = (typeof PPE_OPTIONS)[number];

/** EPIs básicos para a montagem. O protetor auricular só quando necessário, em área externa. */
export const MONTAGEM_PPE: { name: PpeName; when?: string }[] = [
  { name: "Capacete" },
  { name: "Calça comprida" },
  { name: "Camiseta" },
  { name: "Sapato de proteção" },
  { name: "Protetor auricular", when: "se necessário, em área externa" },
];

/** O que já vem marcado numa visita nova: o básico da montagem, menos o que é só às vezes. */
export const DEFAULT_VISIT_PPE: PpeName[] = MONTAGEM_PPE.filter((p) => !p.when).map((p) => p.name);
