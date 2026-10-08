/**
 * Briefing do evento: os blocos do formulário e as 13 frentes de estrutura,
 * na ordem do roadmap. Usado na tela, no relatório e no serviço.
 */

export const BRIEFING_FRONTS = [
  { key: "CENOGRAFIA", label: "Cenografia" },
  { key: "INFRAESTRUTURA", label: "Infraestrutura" },
  { key: "AUDIO", label: "Áudio" },
  { key: "VIDEO", label: "Vídeo" },
  { key: "ILUMINACAO", label: "Iluminação" },
  { key: "MOBILIARIO", label: "Mobiliário" },
  { key: "CREDENCIAMENTO", label: "Credenciamento" },
  { key: "SEGURANCA", label: "Segurança" },
  { key: "LIMPEZA", label: "Limpeza" },
  { key: "ALIMENTACAO", label: "Alimentação" },
  { key: "STAFF", label: "Staff" },
  { key: "TRANSPORTE", label: "Transporte" },
  { key: "LOGISTICA", label: "Logística" },
] as const;

export type BriefingFrontKey = (typeof BRIEFING_FRONTS)[number]["key"];

type Field = { key: string; label: string; max: number; long?: boolean; hint?: string };

/** Campos de texto do briefing, por bloco. */
export const BRIEFING_BLOCKS = [
  {
    title: "Cliente",
    fields: [
      { key: "clientCompany", label: "Empresa", max: 200 },
      { key: "clientAgency", label: "Agência", max: 200 },
      { key: "clientResponsible", label: "Responsável no cliente", max: 200, hint: "Quem aprova pelo cliente." },
      { key: "clientContact", label: "Contato", max: 500, hint: "Nome, telefone e e-mail de quem fala com a produção." },
    ],
  },
  {
    title: "Evento",
    fields: [
      { key: "objective", label: "Objetivo", max: 4000, long: true, hint: "O que o cliente quer alcançar com o evento." },
      { key: "concept", label: "Conceito", max: 4000, long: true, hint: "Tema, linguagem visual, a ideia do evento." },
      { key: "audienceProfile", label: "Público", max: 2000, long: true, hint: "Quem vem: perfil, convidados, imprensa, acessibilidade." },
    ],
  },
  {
    title: "Local",
    fields: [
      { key: "venueContacts", label: "Contatos do local", max: 2000, long: true, hint: "Nome, função e telefone de quem atende no local." },
      { key: "allowedHours", label: "Horários permitidos", max: 2000, long: true, hint: "Montagem, carga e descarga, som, desmontagem." },
      { key: "venueRules", label: "Regras do local", max: 4000, long: true, hint: "O que o local proíbe ou exige." },
    ],
  },
] as const satisfies readonly { title: string; fields: readonly Field[] }[];

export type BriefingTextKey = (typeof BRIEFING_BLOCKS)[number]["fields"][number]["key"];
export const BRIEFING_TEXT_KEYS = BRIEFING_BLOCKS.flatMap((b) => b.fields.map((f) => f.key)) as BriefingTextKey[];
