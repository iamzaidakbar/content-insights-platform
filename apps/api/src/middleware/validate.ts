import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodType } from 'zod';

import type { ApiFieldError } from '@content-insights/shared';

import { ValidationError } from '../lib/errors.js';

interface ValidateSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

function toFieldErrors(error: ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

// Validates req.body/query/params against zod schemas, returning 400 with field-level
// errors on failure — replaces this codebase's earlier convention of surfacing only
// `parsed.error.issues[0]?.message`. Each validated section is replaced with its parsed
// (coerced/defaulted, per the schema) value, so handlers read already-typed data.
//
// Path params that identify a resource by id are deliberately NOT validated here — see
// lib/objectId.ts's parseObjectIdParam, which maps a malformed id to 404 (not 400) so a
// caller can't distinguish "malformed" from "doesn't exist" for resource identity in a URL.
export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      const parsed = schemas.body.safeParse(req.body);
      if (!parsed.success) {
        next(new ValidationError('Invalid request body', toFieldErrors(parsed.error)));
        return;
      }
      req.body = parsed.data;
    }

    if (schemas.query) {
      const parsed = schemas.query.safeParse(req.query);
      if (!parsed.success) {
        next(new ValidationError('Invalid query parameters', toFieldErrors(parsed.error)));
        return;
      }
      req.query = parsed.data as typeof req.query;
    }

    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);
      if (!parsed.success) {
        next(new ValidationError('Invalid path parameters', toFieldErrors(parsed.error)));
        return;
      }
      req.params = parsed.data as typeof req.params;
    }

    next();
  };
}
