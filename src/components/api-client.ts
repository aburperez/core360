"use client";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
  }
}

/** Chamada à API do próprio app. Erros viram mensagens em português. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body instanceof FormData ? undefined : { "content-type": "application/json" },
      body: init.body instanceof FormData ? init.body : init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Sem conexão. Nada foi perdido: tente de novo quando o sinal voltar.", 0, "OFFLINE");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    const fallback = res.status === 401 ? "Sua sessão expirou. Entre de novo." : "Não foi possível concluir. Tente de novo.";
    throw new ApiError(err.message ?? json?.message ?? fallback, res.status, err.code, err.details);
  }
  return (json?.data ?? json) as T;
}
