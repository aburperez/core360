import { z } from "zod";
import type { Actor } from "../../server/authz/actor";
import { isAgencyAdmin } from "../../server/authz/actor";
import { audit, diff } from "../../server/audit/audit";
import { NotFoundError } from "../../server/errors";
import { optionalText, parse, text, uuid } from "../../lib/validation";

/**
 * Clientes da agência (quem contrata o evento). Só o Admin da agência vê a
 * lista e cadastra; a RLS faz o mesmo no banco.
 */

/** A agência em que o Admin está trabalhando: a pedida, ou a única que ele tem. */
export function resolveAgency(actor: Actor, agencyId?: string | null) {
  const id = agencyId ?? (actor.adminAgencies.length === 1 ? actor.adminAgencies[0].id : null);
  if (!id || !uuid.safeParse(id).success || !isAgencyAdmin(actor, id)) throw new NotFoundError("Agência");
  return actor.adminAgencies.find((a) => a.id === id)!;
}

const select = {
  id: true, name: true, document: true, contactName: true, email: true, phone: true, status: true, createdAt: true,
  _count: { select: { events: { where: { deletedAt: null } } } },
} as const;

export async function listClients(actor: Actor, agencyId?: string | null) {
  const agency = resolveAgency(actor, agencyId);
  const rows = await actor.run((tx) =>
    tx.client.findMany({ where: { agencyId: agency.id, deletedAt: null }, orderBy: [{ status: "asc" }, { name: "asc" }], select }),
  );
  return rows.map(({ _count, ...c }) => ({ ...c, events: _count.events }));
}

const fields = {
  name: text(120),
  document: optionalText(30),
  contactName: optionalText(120),
  email: z.union([z.literal(""), z.email({ message: "E-mail inválido" })]).optional().transform((v) => (v ? v.trim().toLowerCase() : null)),
  phone: optionalText(30),
};

const createSchema = z.object({ agencyId: uuid.optional(), ...fields });

export async function createClient(actor: Actor, input: unknown) {
  const { agencyId, ...data } = parse(createSchema, input);
  const agency = resolveAgency(actor, agencyId);
  return actor.run(async (tx) => {
    const c = await tx.client.create({ data: { ...data, agencyId: agency.id }, select: { id: true, name: true } });
    await audit(tx, actor, { entity: "client", entityId: c.id, action: "CREATE", after: { agencyId: agency.id, name: data.name } });
    return c;
  });
}

const updateSchema = z.object({
  name: fields.name.optional(),
  document: fields.document,
  contactName: fields.contactName,
  email: fields.email,
  phone: fields.phone,
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function updateClient(actor: Actor, clientId: string, input: unknown) {
  if (!uuid.safeParse(clientId).success) throw new NotFoundError("Cliente");
  const parsed = parse(updateSchema, input);
  // Campo que não veio fica como está (o "email" opcional vira null sem isso).
  const raw = (input ?? {}) as Record<string, unknown>;
  const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw));
  return actor.run(async (tx) => {
    const before = await tx.client.findFirst({
      where: { id: clientId, deletedAt: null },
      select: { agencyId: true, name: true, document: true, contactName: true, email: true, phone: true, status: true },
    });
    if (!before || !isAgencyAdmin(actor, before.agencyId)) throw new NotFoundError("Cliente");
    const changes = diff(before, data);
    if (!Object.keys(changes.after).length) return { id: clientId };
    await tx.client.update({ where: { id: clientId }, data });
    const action = "status" in changes.after ? (data.status === "ACTIVE" ? "ACTIVATE" : "DEACTIVATE") : "UPDATE";
    await audit(tx, actor, { entity: "client", entityId: clientId, action, ...changes });
    return { id: clientId };
  });
}
