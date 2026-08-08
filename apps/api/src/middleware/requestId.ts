import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';

// Honors an inbound x-request-id (e.g. from a load balancer or upstream proxy that
// already assigned one) so a single request's id stays consistent end-to-end; falls
// back to generating a fresh UUID v4 via the built-in crypto module (no extra
// dependency needed — Node's randomUUID() already produces a spec-compliant UUID).
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();

  req.id = id;
  req.log = logger.child({ requestId: id });
  res.setHeader(REQUEST_ID_HEADER, id);

  next();
}
