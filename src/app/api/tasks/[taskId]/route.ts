import { authed, body } from "@/server/http/handler";
import { deleteTask, getTask, updateTask } from "@/modules/pendencies/pendencies.service";

export const GET = authed<{ taskId: string }>(({ actor, params }) => getTask(actor, params.taskId));

/** Muda nome, data, área ou responsável da pendência. */
export const PATCH = authed<{ taskId: string }>(async ({ req, actor, params }) => updateTask(actor, params.taskId, await body(req)));

export const DELETE = authed<{ taskId: string }>(({ actor, params }) => deleteTask(actor, params.taskId));
