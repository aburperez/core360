/** Texto do e-mail para os fornecedores. */
export function supplierEmail(p: { title: string; briefing: string; eventName: string; sender: string }) {
  return [
    "Olá,",
    "",
    `Gostaríamos de receber um orçamento para: ${p.title}.`,
    "",
    p.briefing,
    "",
    `Evento: ${p.eventName}`,
    "",
    "Por favor, envie o orçamento com: CNPJ, razão social, telefone, e-mail, nome do responsável, valor total e condição de pagamento.",
    "",
    "Obrigado,",
    p.sender,
  ].join("\n");
}
