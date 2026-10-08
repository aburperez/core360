import { authed, body } from "@/server/http/handler";
import { deleteDocument, updateDocument } from "@/modules/documents/documents.service";

/** Renomear, trocar a categoria ou liberar para o campo. */
export const PATCH = authed<{ documentId: string }>(async ({ req, actor, params }) => updateDocument(actor, params.documentId, await body(req)));

export const DELETE = authed<{ documentId: string }>(({ actor, params }) => deleteDocument(actor, params.documentId));
