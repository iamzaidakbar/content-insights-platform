import type { ApiFieldError } from '@content-insights/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Named subclasses for the common cases — carry a fixed status/code so call sites don't
// need to repeat them, and give the global error handler explicit classes to branch on.
// AppError itself stays usable directly for one-off status codes that don't warrant a
// named class (e.g. 409 conflicts with a bespoke message, 401s in auth flows).
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(403, code, message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(401, code, message);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Invalid request',
    public readonly fields?: ApiFieldError[],
    code = 'VALIDATION_ERROR',
  ) {
    super(400, code, message);
    this.name = 'ValidationError';
  }
}

export function isDuplicateKeyError(
  err: unknown,
): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
