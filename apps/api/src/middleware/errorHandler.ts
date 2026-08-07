import type { ErrorRequestHandler } from 'express';

import type { ApiError } from '@content-insights/shared';

import { AppError } from '../lib/errors.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const payload: ApiError = { success: false, message: err.message, code: err.code };
    res.status(err.statusCode).json(payload);
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
  } satisfies ApiError);
};
