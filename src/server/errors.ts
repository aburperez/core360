/** Erros de domínio. A camada HTTP traduz para status (src/server/http/handler.ts). */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Faça login para continuar") {
    super(message, 401, "UNAUTHENTICATED");
  }
}

/**
 * Recurso inexistente OU fora do escopo do usuário. Os dois casos respondem
 * igual para não confirmar que um ID existe.
 */
export class NotFoundError extends AppError {
  constructor(what = "Registro") {
    super(`${what} não encontrado`, 404, "NOT_FOUND");
  }
}

/** O usuário vê o recurso, mas não pode executar esta ação. */
export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para esta ação") {
    super(message, 403, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION", details);
  }
}

/** Edição baseada em versão antiga (concorrência/offline). */
export class ConflictError extends AppError {
  constructor(message = "Este registro foi alterado por outra pessoa. Recarregue e tente de novo.", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}
