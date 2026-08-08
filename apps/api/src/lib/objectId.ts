import mongoose from 'mongoose';
import { z } from 'zod';

import { NotFoundError } from './errors.js';

export const objectIdSchema = z.string().refine((value) => mongoose.isValidObjectId(value), {
  message: 'Invalid id format',
});

// Path-param ids intentionally 404 (not 400) on malformed input — indistinguishable from
// "doesn't exist" to the caller, consistent with how every route in this codebase already
// treats a wrong-org id (404, never 403) for resource identity exposed in a URL.
export function parseObjectIdParam(
  value: string | undefined,
  notFoundMessage = 'Resource not found',
  code = 'NOT_FOUND',
): string {
  const result = objectIdSchema.safeParse(value);
  if (!result.success) {
    throw new NotFoundError(notFoundMessage, code);
  }
  return result.data;
}
