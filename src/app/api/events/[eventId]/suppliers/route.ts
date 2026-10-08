import { authed, body } from "@/server/http/handler";
import { createSupplier, listSuppliers } from "@/modules/suppliers/suppliers.service";

/** Cadastro de fornecedores da agência do evento (Pré-produção). */
export const GET = authed<{ eventId: string }>(({ req, actor, params }) => {
  const u = new URL(req.url).searchParams;
  return listSuppliers(actor, params.eventId, { q: u.get("q") ?? undefined, category: u.get("categoria") ?? undefined, archived: u.get("arquivados") === "1" });
});

export const POST = authed<{ eventId: string }>(async ({ req, actor, params }) => createSupplier(actor, params.eventId, await body(req)), { status: 201 });
