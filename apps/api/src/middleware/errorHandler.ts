import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';

import type { ApiError, ApiFieldError } from '@content-insights/shared';

import { logger } from '../lib/logger.js';
import { AppError, ValidationError } from '../lib/errors.js';

function zodErrorToFields(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

// Must be registered last (Express identifies error middleware by its 4-arg arity).
// Known error classes (AppError and its NotFoundError/ForbiddenError/ValidationError/etc.
// subclasses) map to their carried status code and are safe to return verbatim — their
// messages are always author-written, never raw internals. Anything else is unknown by
// definition: log the full error (stack included) server-side, but the client only ever
// gets a generic 500 message — never leak internals like a raw driver error or stack trace.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const log = req.log ?? logger;

  if (err instanceof AppError) {
    const payload: ApiError = {
      success: false,
      message: err.message,
      code: err.code,
      requestId: req.id,
      ...(err instanceof ValidationError && err.fields ? { fields: err.fields } : {}),
    };
    if (err.statusCode >= 500) {
      log.error({ err, requestId: req.id }, 'request failed with server error');
    } else {
      log.warn({ requestId: req.id, code: err.code }, 'request failed');
    }
    res.status(err.statusCode).json(payload);
    return;
  }

  // A raw ZodError (thrown via .parse() instead of .safeParse()) is still a validation
  // failure, not a server fault — map it the same way as ValidationError rather than
  // falling through to the generic 500 branch below.
  if (err instanceof ZodError) {
    const payload: ApiError = {
      success: false,
      message: 'Invalid request',
      code: 'VALIDATION_ERROR',
      requestId: req.id,
      fields: zodErrorToFields(err),
    };
    log.warn({ requestId: req.id, code: payload.code }, 'request failed validation');
    res.status(400).json(payload);
    return;
  }

  log.error({ err, requestId: req.id }, 'unhandled error');
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId: req.id,
  } satisfies ApiError);
};
