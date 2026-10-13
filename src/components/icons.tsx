import type { ReactNode } from "react";

/**
 * Ícones próprios da CORE 360, desenhados para o app (grade de 24 px, traço
 * arredondado). Cada um tem uma parte preenchida de leve, a marca do conjunto:
 * fica bem no menu, nos botões e dentro dos círculos coloridos dos cartões.
 * Herdam a cor do texto (currentColor).
 */
const A = ({ d }: { d: string }) => <path d={d} fill="currentColor" fillOpacity={0.32} stroke="none" />;

const PATHS = {
  // Gestão de campo: capacete de obra.
  field: (
    <>
      <A d="M4.5 16.5V15a7.5 7.5 0 0 1 15 0v1.5z" />
      <path d="M4.5 16.5V15a7.5 7.5 0 0 1 15 0v1.5" />
      <path d="M2.5 16.5h19v2a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1z" />
      <path d="M10 8V6.2a2 2 0 0 1 4 0V8" />
      <path d="M12 11v2.5" />
    </>
  ),
  // Pré-produção: caderno de produção com espiral.
  pre: (
    <>
      <A d="M5 7.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1.5z" />
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5v3M15 2.5v3" />
      <path d="M8.5 11.5h7M8.5 15h7M8.5 18.5h4" />
    </>
  ),
  // Painel: quatro blocos, um destacado.
  overview: (
    <>
      <A d="M4 4h6.5v8.5H4z" />
      <rect x="4" y="4" width="6.5" height="8.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="5" rx="1.5" />
      <rect x="13.5" y="12" width="6.5" height="8" rx="1.5" />
      <rect x="4" y="15.5" width="6.5" height="4.5" rx="1.5" />
    </>
  ),
  // Chamados: giroflex de alerta.
  tickets: (
    <>
      <A d="M7 17v-4a5 5 0 0 1 10 0v4z" />
      <path d="M7 17v-4a5 5 0 0 1 10 0v4" />
      <rect x="4.5" y="17" width="15" height="3.5" rx="1" />
      <path d="M12 2.5v2.5M4.6 5.6l1.6 1.6M19.4 5.6l-1.6 1.6" />
      <path d="M12 11v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  // Equipe: três pessoas, a da frente destacada.
  team: (
    <>
      <A d="M12 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <circle cx="12" cy="9.5" r="3" />
      <path d="M6.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="5" cy="8" r="2" />
      <circle cx="19" cy="8" r="2" />
      <path d="M2 15.5a3.5 3.5 0 0 1 4-2.4M22 15.5a3.5 3.5 0 0 0-4-2.4" />
    </>
  ),
  // Recebimentos: caixa com a tampa destacada.
  receipts: (
    <>
      <A d="M3.5 7.5 12 3.5l8.5 4L12 11.5z" />
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" />
      <path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" />
      <path d="m14.5 15 1.5 1.5 2.5-3" />
    </>
  ),
  // Briefing: megafone.
  briefing: (
    <>
      <A d="M13.5 6.5v11L7 14.5V9.5z" />
      <path d="M3.5 9.5H7l6.5-3v11L7 14.5H3.5z" />
      <path d="m6 14.5 1.5 5h2.5l-1-4.5" />
      <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10" />
    </>
  ),
  // Tipos e SLA: cronômetro com fatia do tempo.
  sla: (
    <>
      <A d="M12 13.5V6a7.5 7.5 0 0 1 6.5 3.75z" />
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M10 2.5h4M12 2.5V6M12 13.5l3.5-3.5M19 5.5l1.5 1.5" />
    </>
  ),
  // Quem faz o quê: grade com uma célula marcada.
  matrix: (
    <>
      <A d="M10 10h4v4h-4z" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 10h17M3.5 14h17M10 3.5v17M14 3.5v17" />
    </>
  ),
  // Orçamento e custos: cédula.
  costs: (
    <>
      <A d="M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  // Funções: crachá.
  functions: (
    <>
      <A d="M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
      <rect x="4.5" y="4" width="15" height="17" rx="2.5" />
      <path d="M10 2.5h4V5h-4z" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8 17.5a4 4 0 0 1 8 0" />
    </>
  ),
  // Relatórios: folha com barras.
  report: (
    <>
      <A d="M14.5 3v4.5H19z" />
      <path d="M5 3h9.5L19 7.5V21H5z" />
      <path d="M14.5 3v4.5H19" />
      <path d="M8.5 17.5v-3M12 17.5v-6M15.5 17.5v-4" />
    </>
  ),
  // Painel executivo: gráfico subindo.
  chart: (
    <>
      <A d="M7 15.5 11 11l3 3 5.5-6.5V20H7z" />
      <path d="M3.5 3.5v17h17" />
      <path d="M7 15.5 11 11l3 3 5.5-6.5" />
      <path d="M16 7.5h3.5V11" />
    </>
  ),
  bell: (
    <>
      <A d="M6 16.5V11a6 6 0 0 1 12 0v5.5z" />
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 21h4M12 3v2" />
    </>
  ),
  // Trocar de evento: setas em sentidos opostos.
  swap: (
    <>
      <path d="M4 8h14l-3.5-3.5" />
      <path d="M20 16H6l3.5 3.5" />
      <A d="M18 8l-3.5 3.5V4.5z" />
    </>
  ),
  edit: (
    <>
      <A d="m14.5 6 3.5 3.5L9 18.5H5.5V15z" />
      <path d="m14.5 6 2-2a1.5 1.5 0 0 1 2 0l1.5 1.5a1.5 1.5 0 0 1 0 2l-2 2L9 18.5H5.5V15z" />
      <path d="M13 20.5h7.5" />
    </>
  ),
  // Excluir: lixeira com tampa.
  trash: (
    <>
      <A d="M6.5 7.5h11l-.8 11.6a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4z" />
      <path d="M6.5 7.5h11l-.8 11.6a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4z" />
      <path d="M4 7.5h16M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h11M4 17.5h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  // Mapa de itens: caixas empilhadas.
  items: (
    <>
      <A d="M8.5 3.5h7v7h-7z" />
      <rect x="8.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="12.5" width="7.5" height="7" rx="1" />
      <rect x="13" y="12.5" width="7.5" height="7" rx="1" />
      <path d="M2.5 21.5h19M12 3.5V6M6.7 12.5V15M16.7 12.5V15" />
    </>
  ),
  // Fornecedores: galpão com chaminé.
  suppliers: (
    <>
      <A d="M14 3.5h5v5h-5z" />
      <path d="M3 20.5V11l5.5 3.5V11l5.5 3.5V3.5h5v17z" />
      <path d="M2 20.5h20M7 17.5h2M12 17.5h2M16.5 12v1M16.5 16v1" />
    </>
  ),
  // Montagem: caminhão.
  truck: (
    <>
      <A d="M2.5 6h11v10h-11z" />
      <path d="M2.5 6h11v10.5h-11z" />
      <path d="M13.5 9.5h4l3.5 3.5v3.5h-7.5" />
      <circle cx="6.5" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  // Pendências: ampulheta.
  pending: (
    <>
      <A d="M9 20.5v-2.2l3-3.3 3 3.3v2.2z" />
      <path d="M6.5 3h11M6.5 21h11" />
      <path d="M8 3v3.5L12 12l4-5.5V3M8 21v-3.5l4-5.5 4 5.5V21" />
    </>
  ),
  calendar: (
    <>
      <A d="M13.5 14h3.5v3.5h-3.5z" />
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M7 14h2M7 17.5h2M11 14h1M11 17.5h1" />
    </>
  ),
  // Contratos: folha com assinatura.
  contract: (
    <>
      <A d="M14.5 3v4.5H19z" />
      <path d="M5 3h9.5L19 7.5V21H5z" />
      <path d="M8.5 10h7M8.5 13.5h4" />
      <path d="M8.5 18c.8-1.4 1.6-1.6 2.2-.3.5 1 1.3 1 2.1-.4.6-.9 1.2-.6 1.6.2.3.5.8.6 1.6.1" />
    </>
  ),
  // Cotações: etiqueta de preço.
  quotes: (
    <>
      <A d="M8.5 9.8a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z" />
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.6 8.6a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z" />
      <circle cx="8.5" cy="8.5" r="1.3" />
      <path d="m11.5 14.5 3-3M13 16l1.5-1.5" />
    </>
  ),
  // Visita técnica: lupa sobre o local.
  visit: (
    <>
      <A d="M8 13v-2.7l2.5-2 2.5 2V13z" />
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="M8 13v-2.7l2.5-2 2.5 2V13z" />
    </>
  ),
  // Documentos: pasta.
  docs: (
    <>
      <A d="M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4.3l2 2.2H19.5A1.5 1.5 0 0 1 21 8.2v.3H3z" />
      <path d="M3 6a1.5 1.5 0 0 1 1.5-1.5h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 8.2v10.3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
      <path d="M3 9.5h18M9 14h6" />
    </>
  ),
  camera: (
    <>
      <A d="M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M3 8.5a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M17.5 9.5h.5" />
    </>
  ),
  copy: (
    <>
      <A d="M9 9h11v11H9z" />
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v.5" />
    </>
  ),
  mail: (
    <>
      <A d="m3.5 6.5 8.5 6.5 8.5-6.5z" />
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  // Planta do evento: mapa dobrado.
  map: (
    <>
      <A d="M9 4l6 2.5V20L9 17.5z" />
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  pin: (
    <>
      <A d="M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
      <path d="M12 21.5s7-6 7-11.5a7 7 0 0 0-14 0c0 5.5 7 11.5 7 11.5z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M10.5 8v5M8 10.5h5" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M8 10.5h5" />
    </>
  ),
  fit: <path d="M3.5 8.5v-4a1 1 0 0 1 1-1h4M15.5 3.5h4a1 1 0 0 1 1 1v4M20.5 15.5v4a1 1 0 0 1-1 1h-4M8.5 20.5h-4a1 1 0 0 1-1-1v-4" />,
  upload: (
    <>
      <A d="M4 15.5h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" />
    </>
  ),
  download: (
    <>
      <A d="M4 15.5h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      <path d="M12 3.5V15M7.5 10.5 12 15l4.5-4.5" />
    </>
  ),
  chevron: <path d="m9.5 6 6 6-6 6" />,
  // Inteligência: brilho de ideia.
  sparkles: (
    <>
      <A d="M10 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" />
      <path d="M10 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z" />
      <path d="M18 14c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8z" />
    </>
  ),
  paperclip: <path d="m20.5 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8" />,
  // Busca.
  search: (
    <>
      <A d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z" />
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  // Agência: prédio de escritórios.
  agency: (
    <>
      <A d="M5 3.5h9v4H5z" />
      <path d="M5 21V3.5h9V21M14 9h5v12" />
      <path d="M3 21h18M8 7.5h3M8 11h3M8 14.5h3M16.5 12.5v.5M16.5 16v.5" />
    </>
  ),
  // Cliente: aperto de mãos simplificado (pessoa com estrela).
  client: (
    <>
      <A d="M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 10.5-5.1" />
      <path d="m18 14 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5L17 16z" />
    </>
  ),
  // Arquivo / encerrados: caixa de arquivo.
  archive: (
    <>
      <A d="M3 4h18v4.5H3z" />
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4" />
    </>
  ),
  // Suporte: fone com microfone.
  support: (
    <>
      <A d="M3.5 13.5h3v5h-1.5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M3.5 17v-5a8.5 8.5 0 0 1 17 0v5" />
      <path d="M3.5 13.5h3v5h-1.5a1.5 1.5 0 0 1-1.5-1.5zM20.5 13.5h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5z" />
      <path d="M19 18.5c0 1.5-1.5 2.5-4 2.5h-1.5" />
    </>
  ),
  info: (
    <>
      <A d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  home: (
    <>
      <A d="M9.5 20.5V14h5v6.5z" />
      <path d="M3.5 11 12 3.5l8.5 7.5" />
      <path d="M5.5 9.5v11h13v-11" />
      <path d="M9.5 20.5V14h5v6.5" />
    </>
  ),
  logout: (
    <>
      <A d="M4 4.5h8v15H4z" />
      <path d="M12 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5H12" />
      <path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-6 w-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
