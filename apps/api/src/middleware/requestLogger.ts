import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

// Structured replacement for morgan — one JSON (or pretty-printed, in dev) log line per
// completed request, tagged with the request id assigned by the requestId middleware so
// it can be correlated with any error log lines the same request produced.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const log = req.log ?? logger;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    log[level](
      {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      'request completed',
    );
  });

  next();
}
