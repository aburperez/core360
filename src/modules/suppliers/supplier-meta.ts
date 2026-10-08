import type { Actor } from "../../server/authz/actor";
import { membershipFor } from "../../server/authz/actor";
import { canReviewSla } from "../../server/authz/policy";

/**
 * Quem é o diretor no cadastro de fornecedores, pelo evento por onde a pessoa
 * entrou: o Gerente do evento ou o Admin da agência (o Suporte só olha).
 * Espelha app.is_agency_director.
 */
export function isSupplierDirector(actor: Actor, eventId: string): boolean {
  return canReviewSla(actor, eventId) && !actor.supportEventIds.has(eventId);
}

/** Fornecedores contratados no campo: o gestor (todos) e o Head (os da área dele). */
export function canSeeContractedSuppliers(actor: Actor, eventId: string): boolean {
  return canReviewSla(actor, eventId) || membershipFor(actor, eventId)?.role === "HEAD";
}

export const BONUS_KIND_LABEL = { PERCENTUAL: "Percentual", VALOR: "Valor" } as const;

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "5% · acima de R$ 50 mil no ano" ou "R$ 2.000,00". */
export function bonusText(b: { kind: "PERCENTUAL" | "VALOR"; value: number; notes: string | null }) {
  const v = b.kind === "PERCENTUAL" ? `${b.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : brl(b.value);
  return b.notes ? `${v} · ${b.notes}` : v;
}
